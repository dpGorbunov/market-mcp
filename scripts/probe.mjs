// Живая проверка всех площадок: node scripts/probe.mjs ["запрос"]. Открывает окно браузера, закрывает в конце.
import { search, reviews } from "../src/ozon.js";
import { dnsSearch, dnsProduct, dnsReviews } from "../src/dns.js";
import { yandexSearch, yandexCard } from "../src/yandex.js";
import { shutdown } from "../src/browser.js";
const q = process.argv[2] || "Bosch PIB375FB1E";
const brief = (o) => JSON.stringify(o, null, 1).slice(0, 1800);
try {
  const s = await search({ query: q, limit: 3 });
  console.log("ozon_search:", brief(s.items.map((i) => [i.sku, i.name.slice(0, 50), i.price, i.rating, i.reviews])));
  if (s.items[0]) { const r = await reviews({ product: s.items[0].url, sort: "worst", limit: 2 }); console.log("ozon_reviews:", brief({ rating: r.rating, distribution: r.distribution, paging: r.paging, first: r.reviews[0] })); }
  const d = await dnsSearch({ query: q, limit: 3 });
  console.log("dns_search:", brief(d));
  const t = d.items.find((i) => i.reviews) || d.items[0];
  if (t) { const p = await dnsProduct({ product: t.url }); console.log("dns_product:", brief({ name: p.name, price: p.price, n: Object.keys(p.characteristics).length })); const r = await dnsReviews({ product: t.url, limit: 2 }); console.log("dns_reviews:", brief({ rating: r.rating, distribution: r.distribution, first: r.reviews[0] })); }
  const y = await yandexSearch({ query: q, limit: 3 });
  console.log("yandex_search:", brief(y.items.map((i) => [i.name.slice(0, 50), i.price, i.priceOld, i.rating])));
  if (y.items[0]) { const c = await yandexCard({ product: y.items[0].url }); console.log("yandex_card:", brief({ name: c.name, price: c.price, offersCount: c.offersCount, seller: c.seller, n: Object.keys(c.characteristics).length, sample: Object.entries(c.characteristics).slice(0, 4) })); }
} finally { await shutdown(); }
