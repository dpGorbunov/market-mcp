// One long-lived Chromium with a persistent profile (~/.market-mcp/profile) shared by all
// marketplaces. Headed by default: Ozon (Variti), DNS (Qrator) and Yandex (SmartCaptcha)
// pass a visible browser but hand a headless one a real captcha. Cookies survive restarts,
// so the anti-bot challenge is paid once. If a captcha still shows up, the window stays open
// and we wait for the user to solve it (MARKET_CAPTCHA_WAIT_S, default 120).
//
//  - lazy init on first call; context 'close' -> relaunch on next call
//  - Ozon: fetch() to composer-api from a page that stays on ozon.ru (cookies + origin apply)
//  - other sites: openPage() navigates a fresh tab and hands back a page for evaluate()
//  - idle timer closes the browser after MARKET_IDLE_MIN (default 10) minutes
//  - all logs go to stderr (stdout is the MCP JSON-RPC wire)

import { chromium } from "playwright";
import { homedir } from "os";
import { join } from "path";

const OZON_HOME = "https://www.ozon.ru/";
const OZON_API = "https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=";
const PROFILE = process.env.MARKET_PROFILE_DIR || join(homedir(), ".market-mcp", "profile");
const HEADLESS = process.env.MARKET_HEADLESS === "true";
const CAPTCHA_WAIT_MS = 1000 * Number(process.env.MARKET_CAPTCHA_WAIT_S || 120);
const IDLE_TIMEOUT_MS = 60 * 1000 * Number(process.env.MARKET_IDLE_MIN || 10);
const NAV_TIMEOUT_MS = 90000;

// Титулы страниц-заглушек антибота у всех площадок.
const CHALLENGE = /antibot|доступ ограничен|нет соединения|captcha|проверка браузера|qrator|robot|attention required|access denied/i;

const LAUNCH_ARGS = ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check", "--mute-audio"];

const log = (...a) => console.error("[browser]", ...a);

let context = null;
let ozonPage = null; // stays on ozon.ru, all composer fetches run from it
let ozonReady = false;
let initPromise = null;
let idleTimer = null;

function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => shutdown().catch(() => {}), IDLE_TIMEOUT_MS);
  idleTimer.unref?.();
}

async function launch() {
  log(`launching chromium (${HEADLESS ? "headless" : "headed"}), profile ${PROFILE}`);
  context = await chromium.launchPersistentContext(PROFILE, {
    headless: HEADLESS,
    args: LAUNCH_ARGS,
    locale: "ru-RU",
    viewport: { width: 1280, height: 860 },
  });
  context.on("close", () => {
    context = null;
    ozonPage = null;
    ozonReady = false;
  });
  ozonReady = false;
}

export async function ensureContext() {
  if (context) return context;
  if (initPromise) return initPromise;
  initPromise = launch().finally(() => (initPromise = null));
  await initPromise;
  return context;
}

/** Ждёт, пока страница перестанет быть заглушкой антибота (JS-проверка проходит сама, капчу решает человек). */
export async function waitChallenge(page, label) {
  const t0 = Date.now();
  let title = await page.title().catch(() => "");
  let warned = false;
  while (CHALLENGE.test(title) && Date.now() - t0 < CAPTCHA_WAIT_MS) {
    if (!warned && Date.now() - t0 > 15000) {
      log(`${label}: still on "${title.slice(0, 40)}", solve the captcha in the browser window (waiting up to ${CAPTCHA_WAIT_MS / 1000}s)`);
      await page.bringToFront().catch(() => {});
      warned = true;
    }
    await page.waitForTimeout(1000);
    title = await page.title().catch(() => "");
  }
  if (CHALLENGE.test(title)) throw new Error(`${label}: challenge not passed in ${CAPTCHA_WAIT_MS / 1000}s (title: ${title.slice(0, 60)})`);
  return title;
}

async function ensureOzon() {
  await ensureContext();
  if (ozonReady && ozonPage && !ozonPage.isClosed()) return ozonPage;
  ozonPage = await context.newPage();
  await ozonPage.goto(OZON_HOME, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  const title = await waitChallenge(ozonPage, "ozon");
  // после проверки страница перезагружается сама: дождаться конца навигации, иначе evaluate попадёт в её середину
  await ozonPage.waitForLoadState("load", { timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await ozonPage.waitForTimeout(1000);
  ozonReady = true;
  log("ozon ready:", title.slice(0, 40));
  return ozonPage;
}

// Очередь на площадку: параллельные запросы к одному сайту (compare, обход страниц) ловят 403 у
// Ozon и обрыв навигации у DNS. Разные площадки идут параллельно, внутри одной - по очереди.
const queues = new Map();
export function queued(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  queues.set(key, run);
  run.then(() => {}, () => {}).finally(() => { if (queues.get(key) === run) queues.delete(key); });
  return run;
}

const DEAD = /Target page, context or browser has been closed|Session closed|Connection closed|browser has been closed/i;
const NAVIGATED = /Execution context was destroyed|Cannot find context|Frame was detached/i;

/** Ozon composer-api как JSON по пути сайта ("/search/?text=..."). Повтор один раз при 403/307 или мёртвом браузере. */
export function fetchJson(path, opts) {
  return queued("ozon", () => fetchJsonNow(path, opts));
}

async function fetchJsonNow(path, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      resetIdle();
      const page = await ensureOzon();
      const body = await page.evaluate(async (url) => {
        const r = await fetch(url, { headers: { accept: "application/json" } });
        return { status: r.status, text: await r.text() };
      }, OZON_API + encodeURIComponent(path));
      if (body.status !== 200) {
        if ((body.status === 403 || body.status === 307) && attempt < retries) {
          log(`ozon HTTP ${body.status} on ${path.slice(0, 60)}, retry ${attempt + 1}`);
          ozonReady = false;
          await ozonPage?.close().catch(() => {});
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        throw new Error(`Ozon returned HTTP ${body.status}`);
      }
      return JSON.parse(body.text);
    } catch (err) {
      const msg = String(err?.message);
      if (NAVIGATED.test(msg) && attempt < retries + 1) {
        ozonReady = false; // страница ушла в навигацию (редирект антибота): пересоздать вкладку
        await ozonPage?.close().catch(() => {});
        continue;
      }
      if (DEAD.test(msg) && attempt < retries) {
        await shutdown();
        continue;
      }
      throw err;
    }
  }
}

/**
 * Открыть URL в новой вкладке общего профиля, дождаться прохождения антибота и отдать страницу.
 * Вызывающий обязан закрыть страницу (page.close()) в finally.
 */
export async function openPage(url, { label = "page", waitUntil = "domcontentloaded", settleMs = 0 } = {}) {
  resetIdle();
  await ensureContext();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil, timeout: NAV_TIMEOUT_MS });
    await waitChallenge(page, label);
    if (settleMs) await page.waitForTimeout(settleMs);
    return page;
  } catch (err) {
    await page.close().catch(() => {});
    throw err;
  }
}

export async function shutdown() {
  clearTimeout(idleTimer);
  ozonReady = false;
  ozonPage = null;
  const ctx = context;
  context = null;
  try {
    const b = ctx?.browser();
    await ctx?.close();
    await b?.close(); // persistent context не всегда гасит процесс Chromium
  } catch {}
}
