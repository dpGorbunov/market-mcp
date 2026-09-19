// Яндекс.Маркет: поиск предложений (цены разных продавцов, рейтинг), карточка предложения, отзывы.
// Отзывы висят не на всех карточках: у карточек-предложений продавцов "Нет отзывов и оценок", у карточек
// модели они есть (страница <card>/reviews). Оценки отдельных отзывов в тексте страницы не выводятся.
import { openPage, queued } from "./browser.js";
import { refine } from "./rank.js";

const BASE = "https://market.yandex.ru";

function withPage(url, label, fn, settleMs = 3000) {
  return queued("yandex", async () => {
    const page = await openPage(url, { label, settleMs });
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  });
}

// Выполняется в браузере (передаётся исходником). Цены на Маркете пишутся как "45 071\n ₽":
// склеиваем группы цифр через любой юникод-пробел и берём числа перед знаком рубля.
function pageHelpers() {
  const norm = (s) => String(s || "").replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000]/g, " ").replace(/(\d)[ ](?=\d{3}(?!\d))/g, "$1");
  // цены товара: не "от 877 ₽/мес", не кешбэк/баллы
  const prices = (txt) => [...txt.matchAll(/(\d{3,8})\s*₽/g)]
    .filter((m) => !/^\s*\/|^\s*в мес/i.test(txt.slice(m.index + m[0].length, m.index + m[0].length + 6)) && !/кешб|балл|бонус|верн|от\s*$/i.test(txt.slice(Math.max(0, m.index - 20), m.index)))
    .map((m) => Number(m[1])).filter((n) => n >= 100);
  return { norm, prices };
}

function readCards(page, lim) {
  return page.evaluate(
    ([lim, helpersSrc]) => {
      const { norm, prices } = new Function(`return (${helpersSrc})()`)();
      const seen = new Map();
      for (const a of document.querySelectorAll('a[href*="/card/"], a[href*="/product--"]')) {
        const href = a.getAttribute("href").split("?")[0];
        const t = (a.innerText || "").trim();
        if (!t || /₽|ПРОМОКОД|ОРИГИНАЛ/.test(t) || t.length < 12) continue; // ссылка с названием
        if (seen.has(href)) continue;
        let el = a; // карточка: ближайший предок с ценой в тексте
        for (let k = 0; k < 8 && el.parentElement; k++) {
          el = el.parentElement;
          if (/₽/.test(el.innerText || "") && (el.innerText || "").length < 2500) break;
        }
        const txt = norm(el.innerText);
        const ps = prices(txt);
        const rating = (txt.match(/Рейтинг товара: (\d[.,]\d)/) || txt.match(/(\d[.,]\d)\s*\n?\s*(\d[\d.,]*\s*[Kк]?)?\s*(оцен|отзыв)/i) || [])[1];
        const reviews = (txt.match(/(\d[\d.,]*)\s*([Kк])?\s*(?:оцен|отзыв)/i) || []);
        seen.set(href, {
          name: t.slice(0, 200),
          url: new URL(href, location.origin).href,
          id: (href.match(/\/(\d{6,})\/?$/) || [])[1] || null,
          price: ps.length ? Math.min(...ps) : null,
          priceOld: ps.length > 1 && Math.max(...ps) !== Math.min(...ps) ? Math.max(...ps) : null,
          rating: rating ? Number(rating.replace(",", ".")) : null,
          reviews: reviews[1] ? Math.round(Number(reviews[1].replace(",", ".")) * (reviews[2] ? 1000 : 1)) : null,
          specs: txt.split("\n").filter((l) => /: /.test(l) && l.length < 120 && !/^(Цена|Рейтинг)/.test(l)).slice(0, 6),
        });
        if (seen.size >= lim) break;
      }
      return [...seen.values()];
    },
    [lim, pageHelpers.toString()]
  );
}

/** Поиск Маркета: обход pages страниц (&page=N) и общий клиентский фильтр (rank.js). */
export async function yandexSearch({ query, limit = 12, pages = 1, ...opts }) {
  if (!query || !String(query).trim()) throw new Error("query is required");
  const all = [];
  for (let n = 1; n <= pages; n++) {
    const url = `${BASE}/search?text=${encodeURIComponent(query)}${n > 1 ? `&page=${n}` : ""}`;
    const items = await withPage(url, "yandex-search", (page) => readCards(page, 100));
    if (!items.length) break;
    all.push(...items);
  }
  const items = refine(all, opts, limit);
  return { query, scanned: all.length, count: items.length, items };
}

function cardUrl(product) {
  const p = String(product || "").trim();
  return /^https?:\/\//.test(p) ? p : `${BASE}${p.startsWith("/") ? "" : "/"}${p}`;
}

export async function yandexCard({ product }) {
  return withPage(cardUrl(product), "yandex-card", async (page) => {
    const title = await page.title();
    const data = await page.evaluate((helpersSrc) => {
      const { norm, prices } = new Function(`return (${helpersSrc})()`)();
      const t = norm(document.body.innerText);
      const ps = prices(t);
      const offers = (t.match(/Все (\d+) предложени/) || [])[1];
      const from = (t.match(/от\s*\n?\s*(\d{3,8})\s*\n?\s*рубл/) || [])[1];
      const seller = t.match(/\n([^\n]{2,60})\nМагазин\n(\d[.,]\d)\n([\d.,]+[Kк]?) оценок/) || [];
      const chars = {};
      for (const l of t.split("\n")) {
        const m = l.trim().match(/^([^:]{2,40}): (.{1,160})$/);
        if (m && !/^(Цена|Доставка|Рейтинг)/.test(m[1])) chars[m[1]] = m[2];
        if (Object.keys(chars).length > 60) break;
      }
      return {
        price: ps.length ? ps[0] : null,
        priceOld: ps.length > 1 && ps[1] > ps[0] ? ps[1] : null,
        offersCount: offers ? Number(offers) : null,
        priceFrom: from ? Number(from) : null,
        seller: seller[1] ? { name: seller[1], rating: Number(seller[2].replace(",", ".")), ratings: seller[3] } : null,
        noReviews: /Нет отзывов и оценок/.test(t),
        characteristics: chars,
      };
    }, pageHelpers.toString());
    return { url: page.url(), name: title.replace(/ — купить.*$/, "").replace(/ от продавца.*$/, ""), ...data };
  });
}

const DATE_RU = /^(\d{1,2})\s+(январ|феврал|март|апрел|ма|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-я]*(?:\s+(\d{4}))?$/i;
const MONTHS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];

/**
 * Текст страницы /reviews Маркета -> отзывы. Блок: автор, дата ("14 ноября 2025" или "11 сентября" для
 * текущего года), строки "Достоинства:", "Недостатки:", "Комментарий:", затем "Ответить", число "полезно",
 * "Цвет товара: ...". Оценка отзыва в тексте страницы не выводится (звёзды иконками), поэтому score=null;
 * общий рейтинг и число оценок берутся из шапки. Отзывы без текста (только оценка) считаются, но не возвращаются.
 */
export function parseYandexReviews(text, limit = 20, now = new Date()) {
  const lines = String(text || "").replace(/\u00a0/g, " ").split("\n").map((l) => l.trim());
  const noReviews = /Нет отзывов и оценок/.test(text);
  const head = lines.join("\n").match(/(\d[.,]\d)\n(\d[\d ]*) оцен(?:ок|ки|ка)(?:\n•\n(\d[\d ]*) отзыв)?/);
  const reviews = [];
  let ratingsOnly = 0;
  for (let i = 1; i < lines.length; i++) {
    const dm = lines[i].match(DATE_RU);
    if (!dm) continue;
    const month = MONTHS.findIndex((m) => dm[2].toLowerCase().startsWith(m)) + 1;
    let year = dm[3] ? Number(dm[3]) : now.getFullYear();
    if (!dm[3] && (month > now.getMonth() + 1 || (month === now.getMonth() + 1 && Number(dm[1]) > now.getDate()))) year--;
    const date = `${year}-${String(month).padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
    const rv = { author: lines[i - 1] || null, date, score: null, pros: "", cons: "", comment: "", useful: null, variant: null };
    let j = i + 1;
    for (; j < lines.length && !DATE_RU.test(lines[j]); j++) {
      const l = lines[j];
      if (l === "Ответить") continue;
      if (/^Показать \d+ ответ/.test(l)) continue;
      if (/^\d+$/.test(l) && rv.useful == null) { rv.useful = Number(l); continue; }
      if (/^Цвет товара:/.test(l)) { rv.variant = l.replace(/^Цвет товара:\s*/, ""); break; }
      const m = l.match(/^(Достоинства|Недостатки|Комментарий):\s*(.*)$/);
      if (m) { rv[m[1] === "Достоинства" ? "pros" : m[1] === "Недостатки" ? "cons" : "comment"] = m[2]; continue; }
      if (rv.useful == null && (rv.pros || rv.cons || rv.comment)) rv.comment = (rv.comment ? rv.comment + " " : "") + l; // перенос строки внутри текста
    }
    if (rv.pros || rv.cons || rv.comment) { if (reviews.length < limit) reviews.push(rv); } else ratingsOnly++;
    i = j - 1;
  }
  return {
    rating: head ? Number(head[1].replace(",", ".")) : null,
    totalRatings: head ? Number(head[2].replace(/\s/g, "")) : null,
    totalReviews: head?.[3] ? Number(head[3].replace(/\s/g, "")) : null,
    noReviews,
    ratingsOnly,
    count: reviews.length,
    reviews,
  };
}

/**
 * Отзывы Маркета по карточке (<card>/reviews). У части карточек (предложения продавцов) отзывов нет
 * (noReviews=true), тогда искать другую карточку той же модели через yandex_search. Оценок отдельных
 * отзывов на странице нет, поэтому maxScore здесь не работает.
 */
export async function yandexReviews({ product, limit = 20, sinceMonths }) {
  const url = cardUrl(product).replace(/\/+$/, "").replace(/\/reviews$/, "") + "/reviews";
  return withPage(url, "yandex-reviews", async (page) => {
    for (let i = 0; i < 4; i++) { // отзывы догружаются при прокрутке
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1200);
    }
    const text = await page.evaluate(() => document.body.innerText);
    const parsed = parseYandexReviews(text, 200);
    let list = parsed.reviews;
    if (sinceMonths != null) {
      const cutoff = new Date(Date.now() - sinceMonths * 30.44 * 86400e3).toISOString().slice(0, 10);
      list = list.filter((r) => r.date >= cutoff);
    }
    return {
      url: page.url(),
      ...parsed,
      hint: parsed.noReviews ? "This Yandex card has no reviews (seller offer card): pick another card of the same model from yandex_search, or use ozon_product_reviews / dns_reviews" : undefined,
      count: Math.min(list.length, limit),
      reviews: list.slice(0, limit),
    };
  }, 5000);
}
