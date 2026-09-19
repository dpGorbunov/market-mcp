// DNS (dns-shop.ru): поиск, характеристики и отзывы. Сайт за Qrator, JSON-API нет, читаем
// отрендеренные страницы из общего браузера: списки по DOM, отзывы и характеристики по innerText.
import { openPage } from "./browser.js";
import { parseDnsOpinions } from "./parse_dns.js";

const BASE = "https://www.dns-shop.ru";

/** Принимает url карточки DNS, путь "/product/<id>/<slug>/" или голый id; отдаёт "<id>/<slug>/" или "<id>/". */
function productKey(product) {
  const p = String(product || "").trim();
  if (!p) throw new Error("product is required (url, path or id)");
  const m = p.match(/\/product\/(?:opinion\/|characteristics\/|analog\/)?([0-9a-f]{16})\/([^/?#]+)?/i);
  if (m) return `${m[1]}/${m[2] ? m[2] + "/" : ""}`;
  if (/^[0-9a-f]{16}$/i.test(p)) return `${p}/`;
  throw new Error("cannot recognise DNS product: pass the product URL or 16-hex id");
}

async function withPage(url, label, fn, settleMs = 4000) {
  const page = await openPage(url, { label, settleMs });
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function dnsSearch({ query, limit = 12 }) {
  if (!query || !String(query).trim()) throw new Error("query is required");
  const url = `${BASE}/search/?q=${encodeURIComponent(query)}`;
  return withPage(url, "dns-search", async (page) => {
    const data = await page.evaluate((lim) => {
      const cards = [...document.querySelectorAll("[data-id='product'], .catalog-product")];
      const out = [];
      for (const c of cards) {
        const a = c.querySelector("a.catalog-product__name");
        if (!a) continue;
        const rating = c.querySelector(".catalog-product__rating");
        const price = c.querySelector(".product-buy__price");
        const rt = (rating?.innerText || "").replace(/\s+/g, " ").trim();
        const rm = rt.match(/(\d[.,]\d+)\s*\|\s*(\d+)/);
        const pm = (price?.innerText || "").replace(/\s/g, "").match(/(\d+)₽/);
        out.push({
          name: (a.innerText || "").trim(),
          url: new URL(a.getAttribute("href"), location.origin).href.split("?")[0],
          price: pm ? Number(pm[1]) : null,
          rating: rm ? Number(rm[1].replace(",", ".")) : null,
          reviews: rm ? Number(rm[2]) : /нет отзывов/i.test(rt) ? 0 : null,
        });
        if (out.length >= lim) break;
      }
      const nothing = /ничего не найдено/i.test(document.body.innerText);
      return { items: out, nothingFound: nothing };
    }, limit);
    return { query, count: data.items.length, nothingFound: data.nothingFound, items: data.items };
  });
}

export async function dnsProduct({ product }) {
  const key = productKey(product);
  return withPage(`${BASE}/product/characteristics/${key}`, "dns-characteristics", async (page) => {
    // полный список характеристик раскрывается кнопкой
    const btn = page.getByText("Все характеристики", { exact: true }).first();
    if (await btn.count()) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
    const data = await page.evaluate(() => {
      const t = document.body.innerText.replace(/[\u00a0\u2009\u202f]/g, " ");
      const pm = t.replace(/\s/g, "").match(/(\d{3,7})₽/);
      const rm = t.match(/(\d[.,]\d+)\s*\n\s*(\d+)\s*отзыв/);
      const characteristics = {};
      let group = "";
      for (const el of document.querySelectorAll(".product-characteristics__group-title, .product-characteristics__spec-title, .product-characteristics__spec-value")) {
        const txt = (el.innerText || "").replace(/\s+/g, " ").trim();
        if (!txt) continue;
        if (el.classList.contains("product-characteristics__group-title")) group = txt;
        else if (el.classList.contains("product-characteristics__spec-title")) characteristics[(group ? group + " / " : "") + txt] = null;
        else {
          const k = Object.keys(characteristics).findLast((x) => characteristics[x] === null);
          if (k) characteristics[k] = txt;
        }
      }
      if (!Object.keys(characteristics).length) {
        // запасной путь по тексту: пары строк между "Характеристики" и "Все характеристики"/"Аксессуары"
        const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
        const start = lines.lastIndexOf("Характеристики");
        for (let i = start + 1; i + 1 < lines.length; i += 2) {
          if (/^(Все характеристики|Аксессуары)$/.test(lines[i])) break;
          characteristics[lines[i]] = lines[i + 1];
        }
      }
      return { price: pm ? Number(pm[1]) : null, rating: rm ? Number(rm[1].replace(",", ".")) : null, reviews: rm ? Number(rm[2]) : null, characteristics };
    });
    const title = await page.title();
    return { url: `${BASE}/product/${key}`, name: title.replace(/^Технические характеристики\s*/i, "").split("|")[0].trim(), ...data };
  });
}

export async function dnsReviews({ product, limit = 20 }) {
  const key = productKey(product);
  return withPage(`${BASE}/product/opinion/${key}`, "dns-opinions", async (page) => {
    const text = await page.evaluate(() => document.body.innerText);
    return { url: `${BASE}/product/opinion/${key}`, ...parseDnsOpinions(text, limit) };
  }, 5000);
}

export const _internal = { productKey };
