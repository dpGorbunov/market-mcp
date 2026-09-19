// High-level Ozon operations: build composer-api paths, fetch via the browser, parse to plain data.
import { fetchJson } from "./browser.js";
import { parseSearch, parseDetails, parseReviews, parseFilters } from "./parse.js";
import { refine } from "./rank.js";

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

/** Серверные параметры поиска Ozon: bool -> key=t, список -> key=a,b, диапазон -> key=min.000;max.000. */
function filterParams(filters = {}) {
  let out = "";
  for (const [k, v] of Object.entries(filters)) {
    if (v == null || v === "" || v === false) continue;
    const val = v === true ? "t" : Array.isArray(v) ? v.join(",") : String(v);
    out += `&${encodeURIComponent(k)}=${encodeURIComponent(val).replace(/%2C/g, ",").replace(/%3B/g, ";")}`;
  }
  return out;
}

function searchPath(query, { sort, priceMin, priceMax, highRating, filters }) {
  let url = `/search/?text=${encodeURIComponent(query)}&from_global=true`;
  const sorting = SORT_MAP[sort];
  if (sorting) url += `&sorting=${sorting}`;
  if (priceMin != null || priceMax != null) url += `&currency_price=${priceMin ?? 0}.000;${priceMax ?? 99999999}.000`;
  if (highRating) url += "&is_high_rating=t";
  url += filterParams(filters);
  return url;
}

/**
 * Поиск с серверными фильтрами Ozon (цена, "высокий рейтинг", бренд по id из ozon_filters, любые
 * key=value) и общим клиентским отбором (rank.js) поверх нескольких страниц выдачи.
 * brand: если среди фильтров бренда первой страницы есть такое название, применяется серверно,
 * иначе отбирается по названию товара.
 */
export async function search({ query, sort = "popular", pages = 1, limit = 12, highRating, filters = {}, ...rest }) {
  if (!query || !String(query).trim()) throw new Error("query is required");
  const opts = { ...rest };
  let path = searchPath(query, { sort, priceMin: opts.priceMin, priceMax: opts.priceMax, highRating, filters });
  let page = await fetchJson(path);
  let serverBrand = null;
  if (opts.brand && !filters.brand) {
    const b = parseFilters(page).find((f) => f.key === "brand");
    const hit = (b?.options || []).find((o) => o.title.toLowerCase() === String(opts.brand).toLowerCase());
    if (hit) {
      serverBrand = hit.title;
      path = searchPath(query, { sort, priceMin: opts.priceMin, priceMax: opts.priceMax, highRating, filters: { ...filters, brand: hit.key } });
      page = await fetchJson(path);
    }
  }
  const all = [];
  let parsed = parseSearch(page, 100);
  all.push(...parsed.items);
  for (let n = 2; n <= pages && parsed.hasNext; n++) {
    parsed = parseSearch(await fetchJson(`${path}&page=${n}`), 100);
    all.push(...parsed.items);
  }
  const items = refine(all, opts, limit);
  return { query, sort, pagesWalked: Math.min(pages, all.length ? pages : 1), scanned: all.length, serverBrand, count: items.length, items };
}

/** Фильтры, которые Ozon предлагает для запроса (бренды с id, тип, страна, диапазоны). Ключи идут в search.filters. */
export async function filters({ query }) {
  if (!query || !String(query).trim()) throw new Error("query is required");
  const q = encodeURIComponent(query);
  const [side, modal] = await Promise.all([
    fetchJson(`/search/?text=${q}&from_global=true`),
    fetchJson(`/modal/allFilters/search/?from_global=true&text=${q}`).catch(() => null),
  ]);
  const list = parseFilters(side);
  for (const f of modal ? parseFilters(modal) : []) if (!list.some((x) => x.key === f.key)) list.push(f);
  return {
    query,
    howToUse: "pass as ozon_search.filters: bool -> {key: true}, checkboxes -> {key: 'optionKey'} or [keys], range -> {key: 'min;max'}",
    count: list.length,
    filters: list,
  };
}

export async function details({ product }) {
  const basePage = await fetchJson(productPath(product));
  // страница описания требует полный путь со slug: по голому sku Ozon отдаёт 403
  const seo = basePage?.seo?.link?.[0]?.href;
  const path = seo ? productPath(seo) : productPath(product);
  const page2 = await fetchJson(`${path}?layout_container=pdpPage2column&layout_page_index=2`, { retries: 0 }).catch(() => null);
  return parseDetails(basePage, page2 || {});
}

const REVIEW_SORT = { newest: "published_at_desc", best: "score_desc", worst: "score_asc" };

/** Одна страница отзывов; следующие страницы идут по page_key из ссылок пагинации предыдущей. */
async function reviewsPage(path, sortKey, pageNo, links) {
  let query = `?sort=${sortKey}`;
  if (pageNo > 1) {
    const link = (links || []).find((l) => String(l.text) === String(pageNo));
    query = link?.urlParams || `?page=${pageNo}&sort=${sortKey}`;
  }
  const raw = await fetchJson(`${path}reviews/${query}`);
  const key = Object.keys(raw.widgetStates || {}).find((k) => k.startsWith("webListReviews"));
  const nextLinks = key ? JSON.parse(raw.widgetStates[key]).paging?.links || [] : [];
  return { raw, links: nextLinks };
}

/**
 * Отзывы. Без sinceMonths/maxScore - одна страница в заданной сортировке.
 * С sinceMonths и/или maxScore - обход новых отзывов (до maxPages страниц по 30) и отбор тех,
 * что не старше sinceMonths месяцев и с оценкой не выше maxScore: "что ломается в свежих партиях".
 */
export async function reviews({ product, sort = "newest", page = 1, limit = 30, sinceMonths, maxScore, maxPages = 5 }) {
  const path = productPath(product);
  if (sinceMonths == null && maxScore == null) {
    let links = [];
    if (page > 1) ({ links } = await reviewsPage(path, REVIEW_SORT[sort] || REVIEW_SORT.newest, 1));
    const { raw } = await reviewsPage(path, REVIEW_SORT[sort] || REVIEW_SORT.newest, page, links);
    return { sort, page, ...parseReviews(raw, limit) };
  }
  const cutoff = sinceMonths != null ? new Date(Date.now() - sinceMonths * 30.44 * 86400e3).toISOString().slice(0, 10) : null;
  const picked = [];
  let scanned = 0;
  let head = null;
  let links = [];
  let stop = false;
  for (let n = 1; n <= maxPages && !stop; n++) {
    const r = await reviewsPage(path, REVIEW_SORT.newest, n, links);
    links = r.links;
    const parsed = parseReviews(r.raw, 30);
    if (!head) head = parsed;
    if (!parsed.reviews.length) break;
    for (const rv of parsed.reviews) {
      if (cutoff && rv.date && rv.date < cutoff) { stop = true; break; }
      scanned++;
      if (maxScore == null || (typeof rv.score === "number" && rv.score <= maxScore)) picked.push(rv);
    }
    if (!links.some((l) => String(l.text) === String(n + 1))) break;
  }
  return {
    sort: "newest",
    sinceMonths: sinceMonths ?? null,
    maxScore: maxScore ?? null,
    rating: head?.rating ?? null,
    totalReviews: head?.totalReviews ?? null,
    distribution: head?.distribution ?? null,
    scanned,
    count: Math.min(picked.length, limit),
    reviews: picked.slice(0, limit),
  };
}

export const _internal = { productPath, filterParams };
