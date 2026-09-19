// High-level Ozon operations: build composer-api paths, fetch via the browser, parse to plain data.
import { fetchJson } from "./browser.js";
import { parseSearch, parseDetails, parseReviews } from "./parse.js";

const SORT_MAP = {
  popular: "",
  price: "price",
  price_desc: "price_desc",
  rating: "rating",
  new: "new",
  discount: "discount",
};

/** Accept a product as sku ("1185261285"), full url, or slug; return the site path "/product/.../". */
function productPath(product) {
  const p = String(product || "").trim();
  if (!p) throw new Error("product is required (sku, url, or slug)");
  if (/^https?:\/\//.test(p)) return new URL(p).pathname.replace(/\/?$/, "/");
  if (p.startsWith("/product/")) return p.replace(/\/?$/, "/");
  if (/^\d+$/.test(p)) return `/product/${p}/`; // bare sku — Ozon resolves the slug
  return `/product/${p.replace(/^\/+|\/+$/g, "")}/`; // slug
}

export async function search({ query, sort = "popular", priceMin, priceMax, limit = 12 }) {
  if (!query || !String(query).trim()) throw new Error("query is required");
  let url = `/search/?text=${encodeURIComponent(query)}&from_global=true`;
  const sorting = SORT_MAP[sort];
  if (sorting) url += `&sorting=${sorting}`;
  if (priceMin != null || priceMax != null) {
    const min = priceMin ?? 0;
    const max = priceMax ?? 99999999;
    url += `&currency_price=${min}.000%3B${max}.000`;
  }
  const page = await fetchJson(url);
  const { items } = parseSearch(page, limit);
  return { query, sort, count: items.length, items };
}

export async function details({ product }) {
  const path = productPath(product);
  const [basePage, page2] = await Promise.all([
    fetchJson(path),
    fetchJson(`${path}?layout_container=pdpPage2column&layout_page_index=2`),
  ]);
  return parseDetails(basePage, page2);
}

const REVIEW_SORT = { newest: "published_at_desc", best: "score_desc", worst: "score_asc" };

export async function reviews({ product, sort = "newest", page = 1, limit = 30 }) {
  const path = productPath(product);
  const s = REVIEW_SORT[sort] || REVIEW_SORT.newest;
  let query = `?sort=${s}`;
  if (page > 1) {
    // страницы дальше первой требуют page_key из ссылок пагинации первой страницы
    const raw = await fetchJson(`${path}reviews/${query}`);
    const key = Object.keys(raw.widgetStates || {}).find((k) => k.startsWith("webListReviews"));
    const links = key ? JSON.parse(raw.widgetStates[key]).paging?.links || [] : [];
    const link = links.find((l) => String(l.text) === String(page));
    query = link?.urlParams || `?page=${page}&sort=${s}`;
  }
  const data = await fetchJson(`${path}reviews/${query}`);
  return { sort, page, ...parseReviews(data, limit) };
}

export const _internal = { productPath };
