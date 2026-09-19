// Яндекс.Маркет: поиск предложений (цены разных продавцов, рейтинг) и карточка предложения.
// Отзывов уровня модели на карточках продавцов нет (там только "Нет отзывов и оценок"), поэтому
// отзывы здесь не отдаём: за отзывами идти в ozon_product_reviews / dns_reviews.
import { openPage } from "./browser.js";

const BASE = "https://market.yandex.ru";

async function withPage(url, label, fn, settleMs = 3000) {
  const page = await openPage(url, { label, settleMs });
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

// Выполняется в браузере (передаётся исходником). Цены на Маркете пишутся как "45 071\n ₽":
// склеиваем группы цифр через любой юникод-пробел и берём числа перед знаком рубля.
function pageHelpers() {
  const norm = (s) => String(s || "").replace(/[  -​ ]/g, " ").replace(/(\d)[ ](?=\d{3}(?!\d))/g, "$1");
  const prices = (txt) => [...txt.matchAll(/(\d{3,8})\s*₽/g)].map((m) => Number(m[1])).filter((n) => n >= 100);
  return { norm, prices };
}

export async function yandexSearch({ query, limit = 12 }) {
  if (!query || !String(query).trim()) throw new Error("query is required");
  return withPage(`${BASE}/search?text=${encodeURIComponent(query)}`, "yandex-search", async (page) => {
    const items = await page.evaluate(
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
          seen.set(href, {
            name: t.slice(0, 200),
            url: new URL(href, location.origin).href,
            id: (href.match(/\/(\d{6,})\/?$/) || [])[1] || null,
            price: ps.length ? Math.min(...ps) : null,
            priceOld: ps.length > 1 && Math.max(...ps) !== Math.min(...ps) ? Math.max(...ps) : null,
            rating: rating ? Number(rating.replace(",", ".")) : null,
            specs: txt.split("\n").filter((l) => /: /.test(l) && l.length < 120 && !/^(Цена|Рейтинг)/.test(l)).slice(0, 6),
          });
          if (seen.size >= lim) break;
        }
        return [...seen.values()];
      },
      [limit, pageHelpers.toString()]
    );
    return { query, count: items.length, items };
  });
}

export async function yandexCard({ product }) {
  const p = String(product || "").trim();
  const url = /^https?:\/\//.test(p) ? p : `${BASE}${p.startsWith("/") ? "" : "/"}${p}`;
  return withPage(url, "yandex-card", async (page) => {
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
