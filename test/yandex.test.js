import assert from 'node:assert/strict';
import {cardUrl, yandexCard, yandexReviews} from '../src/yandex.js';

const canonical = 'https://market.yandex.ru/card/table/4671788663';
for (const value of [canonical, '/card/table/4671788663', 'card/table/4671788663', canonical + '?sku=123#specs']) {
  assert.equal(cardUrl(value), canonical);
}
assert.equal(cardUrl('https://market.yandex.ru/product--table/4671788663/reviews?hid=1'),
  'https://market.yandex.ru/product--table/4671788663');
for (const product of [
  'http://127.0.0.1/card/table/4671788663', 'https://evil.test/card/table/4671788663',
  'https://market.yandex.ru.evil.test/card/table/4671788663', 'https://market.yandex.ru@evil.test/card/table/4671788663',
  'https://user:pass@market.yandex.ru/card/table/4671788663', '//127.0.0.1/card/table/4671788663',
  'https://market.yandex.ru:8443/card/table/4671788663', 'http://market.yandex.ru/card/table/4671788663',
  'https://market.yandex.ru/redirect?url=http://127.0.0.1', 'file:///etc/passwd', '',
  '/card/table%2f..%2f..%2fredirect/4671788663', '/card/table\\evil/4671788663',
]) {
  assert.throws(() => cardUrl(product), /Invalid Yandex Market/);
  await assert.rejects(yandexCard({product}), /Invalid Yandex Market/);
  await assert.rejects(yandexReviews({product}), /Invalid Yandex Market/);
}
console.log('Yandex URL tests passed');

const {readFileSync} = await import('node:fs');
const {chromium} = await import('playwright');
const {parseYandexCharacteristics} = await import('../src/yandex.js');
// Disposable offline browser, never the persistent marketplace/user profile.
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent(readFileSync(new URL('../samples/yandex_card_specs.html', import.meta.url), 'utf8'));
  const parse = id => page.evaluate(([source, id]) => new Function(`return (${source})`)()(id),
    [parseYandexCharacteristics.toString(), id]);
  assert.deepEqual(await parse('4671788663'), {
    'Артикул Маркета': '4671788663', 'Конструкция': 'раздвижной', 'Размеры (ДхШхВ)': '90x150x75 см',
    'Длина в разложенном виде': '150 см', 'Материал столешницы': 'МДФ, шпон',
  });
  assert.deepEqual(await parse('1234567890'), {});
  await page.setContent('<h1>Стол 90 см</h1><div>Длина: 100 см</div><div>Акция: HardFest26</div>');
  assert.deepEqual(await parse('4671788663'), {});
  console.log('Yandex target-card fixture tests passed');
} finally {
  await browser.close();
}
