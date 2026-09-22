import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const forbidden = readFileSync(new URL('./dns-forbidden.html', import.meta.url), 'utf8');
const launch = chromium.launchPersistentContext.bind(chromium);
chromium.launchPersistentContext = async (...args) => {
  const context = await launch(...args);
  const newPage = context.newPage.bind(context);
  context.newPage = async (...args) => {
    const page = await newPage(...args);
    await page.route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith('https://www.dns-shop.ru/') && !url.startsWith('https://market.yandex.ru/')) return route.abort();
      let body = url.startsWith("https://market.yandex.ru/") ? "<title>403</title><h1>Forbidden</h1>" : forbidden;
      if (url.includes('/captcha/')) body = '<title>DNS</title><p>Подтвердите, что вы не робот</p><p>captcha</p>';
      if (url.includes('/good/')) body = '<title>Технические характеристики Xiaomi Air Fryer | DNS</title><p>8999 ₽</p><h2>Характеристики</h2><div>Ширина</div><div>389 мм</div><h2>Аксессуары</h2>';
      if (url.includes('/yandex-good/')) body = '<title>Стол кухонный — купить на Яндекс Маркете</title><h1>Стол кухонный</h1>';
      if (url.includes('/empty/')) body = '<title>Xiaomi | DNS</title><p>Нет описания</p><p>389 мм</p>';
      return route.fulfill({status: url.includes('/status403/') ? 403 : 200, contentType: 'text/html; charset=utf-8', body});
    });
    return page;
  };
  return context;
};
