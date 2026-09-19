#!/usr/bin/env node
// Ozon MCP server (stdio). Three tools: ozon_search, ozon_product_details, ozon_product_reviews.
// CRITICAL: stdout is the JSON-RPC wire — never write to it. All logs go to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { search, details, reviews } from "./ozon.js";
import { dnsSearch, dnsProduct, dnsReviews } from "./dns.js";
import { yandexSearch, yandexCard } from "./yandex.js";
import { shutdown } from "./browser.js";

const log = (...a) => console.error("[ozon-mcp]", ...a);
const TOOL_TIMEOUT_MS = 55000; // stay under typical MCP client timeout (~60s)
const MAX_TEXT = 60000; // cap JSON-RPC payload size

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/** Wrap a tool body: run with timeout, serialize result, convert any failure to isError. */
function tool(label, fn) {
  return async (args) => {
    try {
      const result = await withTimeout(fn(args), TOOL_TIMEOUT_MS, label);
      let text = JSON.stringify(result, null, 2);
      if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + "\n…(truncated)";
      return { content: [{ type: "text", text }] };
    } catch (err) {
      log(`${label} error:`, err?.message);
      return {
        content: [{ type: "text", text: `Error: ${err?.message || String(err)}` }],
        isError: true,
      };
    }
  };
}

const server = new McpServer({ name: "market-mcp", version: "0.1.0" });

server.registerTool(
  "ozon_search",
  {
    title: "Search Ozon products",
    description:
      "Search products on the Ozon marketplace (ozon.ru). Returns a list of products with name, " +
      "price (RUB, numeric), old price, discount, rating, review count, brand, image and a clean " +
      "product URL. Use this to find products and compare prices, then hand the URLs to the user.",
    inputSchema: {
      query: z.string().min(1).describe('Search query, e.g. "iphone 15", "плед 150х200", "носки мужские"'),
      sort: z
        .enum(["popular", "price", "price_desc", "rating", "new", "discount"])
        .default("popular")
        .describe("Sort order: popular (default), price (cheap→expensive), price_desc, rating, new, discount"),
      priceMin: z.number().int().nonnegative().optional().describe("Minimum price in RUB"),
      priceMax: z.number().int().nonnegative().optional().describe("Maximum price in RUB"),
      limit: z.number().int().min(1).max(36).default(12).describe("Max number of results (1–36, default 12)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("ozon_search", search)
);

server.registerTool(
  "ozon_product_details",
  {
    title: "Get Ozon product details",
    description:
      "Get full details for one Ozon product: name, price (card/regular/old), availability, product " +
      "rating, seller (name + rating), images, key characteristics, and the product description " +
      "(text and/or banner image URLs). Accepts an SKU, a full product URL, or a slug.",
    inputSchema: {
      product: z
        .string()
        .min(1)
        .describe('Product SKU (e.g. "1185261285"), full ozon.ru product URL, or product slug'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("ozon_product_details", details)
);

server.registerTool(
  "ozon_product_reviews",
  {
    title: "Get Ozon product reviews",
    description:
      "Read real customer reviews for an Ozon product: author, score (1–5), comment, pros, cons, " +
      "date, usefulness, purchased flag, photos flag; plus the star distribution (5..1 counts) and paging. " +
      "Accepts an SKU, a full product URL, or a slug.",
    inputSchema: {
      product: z
        .string()
        .min(1)
        .describe('Product SKU (e.g. "1185261285"), full ozon.ru product URL, or product slug'),
      sort: z.enum(["newest", "best", "worst"]).default("newest").describe("newest (default), best (5 stars first), worst (1 star first) — read worst first to see real problems"),
      page: z.number().int().min(1).max(50).default(1).describe("Page of 30 reviews"),
      limit: z.number().int().min(1).max(30).default(30).describe("Max number of reviews from the page (1–30, default 30)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("ozon_product_reviews", reviews)
);

// ── DNS ─────────────────────────────────────────────────────────────────────────
server.registerTool(
  "dns_search",
  {
    title: "Search DNS (dns-shop.ru)",
    description:
      "Search electronics and appliances on DNS (dns-shop.ru): name, price (RUB), rating, review count and product URL. " +
      "nothingFound=true means DNS has no exact match and returned similar items instead.",
    inputSchema: {
      query: z.string().min(1).describe('Search query, e.g. "Bosch PIB375FB1E" or "индукционная панель 30 см"'),
      limit: z.number().int().min(1).max(30).default(12).describe("Max results (1–30, default 12)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("dns_search", dnsSearch)
);

server.registerTool(
  "dns_product",
  {
    title: "Get DNS product characteristics",
    description:
      "Full technical characteristics of a DNS product (grouped, e.g. 'Конфорки / Диаметр конфорки'), price, rating and review count. " +
      "Accepts the product URL from dns_search or the 16-hex product id.",
    inputSchema: { product: z.string().min(1).describe("DNS product URL or 16-hex id") },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("dns_product", dnsProduct)
);

server.registerTool(
  "dns_reviews",
  {
    title: "Get DNS product reviews",
    description:
      "Customer reviews from DNS: overall score, per-criterion scores (внешний вид, простота эксплуатации, ...), usage period, pros, cons, comment, date; " +
      "plus the star distribution (5..1). Newest first.",
    inputSchema: {
      product: z.string().min(1).describe("DNS product URL or 16-hex id"),
      limit: z.number().int().min(1).max(50).default(20).describe("Max reviews (1–50, default 20)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("dns_reviews", dnsReviews)
);

// ── Yandex Market ───────────────────────────────────────────────────────────────
server.registerTool(
  "yandex_search",
  {
    title: "Search Yandex Market",
    description:
      "Search offers on Yandex Market (market.yandex.ru): name, everyday price (RUB), struck-through old price, product rating, short specs and offer URL. " +
      "Best source for 'what does it cost right now across sellers'. Seller cards carry no reviews: use ozon_product_reviews or dns_reviews for reviews.",
    inputSchema: {
      query: z.string().min(2).describe("Search query in Russian or model code"),
      limit: z.number().int().min(1).max(30).default(12).describe("Max results (1–30, default 12)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("yandex_search", yandexSearch)
);

server.registerTool(
  "yandex_card",
  {
    title: "Get Yandex Market offer card",
    description: "Offer card on Yandex Market: price, number of offers from other sellers and the lowest one, seller rating, characteristics.",
    inputSchema: { product: z.string().min(1).describe("Offer URL from yandex_search (market.yandex.ru/card/...)") },
    annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
  },
  tool("yandex_card", yandexCard)
);

// ── lifecycle ───────────────────────────────────────────────────────────────────
let cleaning = false;
async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  log("shutting down…");
  await shutdown().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("uncaughtException", (e) => {
  log("uncaughtException:", e);
  cleanup();
});
process.on("unhandledRejection", (r) => log("unhandledRejection:", r));

const transport = new StdioServerTransport();
transport.onclose = cleanup; // client disconnected → free the browser
await server.connect(transport);
log("ready on stdio");
