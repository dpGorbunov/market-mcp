import assert from 'node:assert/strict';
import {productUrl, productSite, requestAllowed} from '../src/urls.js';
import {compare} from '../src/compare.js';
import {details, reviews} from '../src/ozon.js';
import {dnsProduct, dnsReviews} from '../src/dns.js';
import {yandexCard, yandexReviews} from '../src/yandex.js';

const good = {
  ozon: 'https://www.ozon.ru/product/stol-1185261285/',
  dns: 'https://www.dns-shop.ru/product/1234567890abcdef/stol/',
  yandex: 'https://market.yandex.ru/card/stol/4671788663',
};
for (const [site, url] of Object.entries(good)) {
  assert.equal(productSite(url), site);
  assert.equal(productUrl(site, url + '?tracking=abc%20def#x'), url);
}
assert.equal(productUrl('ozon', '1185261285'), 'https://www.ozon.ru/product/1185261285/');
assert.equal(productUrl('dns', '1234567890abcdef'), 'https://www.dns-shop.ru/product/1234567890abcdef/');
assert.equal(productUrl('ozon', 'https://ozon.ru/product/stol-1185261285/reviews/'), good.ozon);
assert.equal(productUrl('dns', '/product/characteristics/1234567890abcdef/stol/'), good.dns);

for (const product of [
  'http://127.0.0.1/product/stol-1185261285/', 'https://localhost/product/stol-1185261285/',
  'https://[::1]/product/stol-1185261285/', 'https://2130706433/product/stol-1185261285/',
  'https://evil.test/product/stol-1185261285/', '//ozon.ru/product/stol-1185261285/',
  'https://www.ozon.ru.evil.test/product/stol-1185261285/',
  'https://www.ozon.ru@evil.test/product/stol-1185261285/',
  'https://user:pass@www.ozon.ru/product/stol-1185261285/',
  'https://www.ozon.ru:443/product/stol-1185261285/', 'https://www.ozon.ru:8080/product/stol-1185261285/',
  '/product/../product/stol-1185261285/', '/product/stol%2f..-1185261285/',
  '/product/stol\\evil-1185261285/', 'file:///etc/passwd', 'javascript:alert(1)',
]) {
  for (const site of Object.keys(good)) assert.throws(() => productUrl(site, product));
  for (const fn of [details, reviews, dnsProduct, dnsReviews, yandexCard, yandexReviews]) {
    await assert.rejects(fn({product}));
  }
  await assert.rejects(compare({products: [good.yandex, product]}));
}
assert(requestAllowed(good.yandex, 'yandex', true));
assert(!requestAllowed(good.ozon, 'yandex', true));
assert(!requestAllowed('https://evil.test/x', 'yandex', true));
assert(requestAllowed('https://yastatic.net/image.png', 'yandex', false));
for (const url of ['http://127.0.0.1:8000', 'https://[::1]/', 'https://10.0.0.1/',
  'https://localhost/', 'https://localhost./', 'https://router.local./', 'https://router.local/', 'https://singlehost/', 'https://user:pass@yastatic.net/x']) {
  assert(!requestAllowed(url, 'yandex', false));
}
console.log('Marketplace URL and request policy tests passed');

const {chromium} = await import('playwright');
const {protectContext, protectPage} = await import('../src/browser.js');
const browser = await chromium.launch({headless: true});
try {
  const context = await browser.newContext({serviceWorkers: 'block'});
  const reached = [], scopes = new WeakMap();
  await context.route('**/*', route => {
    const url = route.request().url();
    reached.push(url);
    if (url.endsWith('/resource-redirect.js')) return route.fulfill({status: 302, headers: {location: 'https://127.0.0.1/leak.js'}});
    if (url.endsWith('/redirect')) return route.fulfill({status: 302, headers: {location: good.ozon}});
    if (url.startsWith('https://yastatic.net/')) return route.fulfill({contentType: 'text/javascript', body: 'window.cdnLoaded=true'});
    return route.fulfill({contentType: 'text/html', body: '<script src="https://yastatic.net/public.js"></script><script src="https://127.0.0.1/private.js"></script><script src="https://yastatic.net/resource-redirect.js"></script>'});
  });
  await protectContext(context, scopes);
  const page = await context.newPage();
  scopes.set(page, 'yandex');
  await protectPage(context, page, scopes);
  await page.goto('https://market.yandex.ru/fixture');
  assert.equal(await page.evaluate(() => window.cdnLoaded), true);
  assert(!reached.some(url => url.includes('127.0.0.1')));
  await assert.rejects(page.goto('https://market.yandex.ru/redirect'));
  assert(!reached.some(url => url.includes('127.0.0.1')));
  assert(!reached.includes(good.ozon));
  const unscoped = await context.newPage();
  await protectPage(context, unscoped, scopes); // guard from the page listener, awaited for determinism
  await assert.rejects(unscoped.goto(good.yandex));
  assert(!reached.includes(good.yandex));
  console.log('Browser redirects blocked before downstream request; CDN resources retained');
} finally {
  await browser.close();
}
