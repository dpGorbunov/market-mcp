import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const folder = await mkdtemp(join(tmpdir(), 'dns-fixture-'));
const transport = new StdioClientTransport({command: process.execPath,
  args: ['--import', fileURLToPath(new URL('./fixtures/dns-browser.js', import.meta.url)), 'src/index.js'],
  env: {...process.env, MARKET_PROFILE_DIR: folder, MARKET_HEADLESS: 'true', MARKET_CAPTCHA_WAIT_S: '0', MARKET_COMPACT: '0'},
  stderr: 'ignore'});
const client = new Client({name: 'dns-regression', version: '1'});
try {
  await client.connect(transport);
  for (const slug of ['status403', 'soft403', 'captcha']) {
    const result = await client.callTool({name: 'dns_product', arguments: {product: `https://www.dns-shop.ru/product/f4c6689d51faed20/${slug}/`}});
    assert.equal(result.isError, true, `${slug} must be a native MCP error`);
    assert.match(result.content[0].text, /HTTP 403|blocked|challenge/i);
    assert.doesNotMatch(result.content[0].text, /"price"|"characteristics"|389/);
  }
  const good = await client.callTool({name: 'dns_product', arguments: {product: 'https://www.dns-shop.ru/product/f4c6689d51faed20/good/'}});
  assert(!good.isError);
  const data = JSON.parse(good.content[0].text);
  assert.equal(data.name, 'Xiaomi Air Fryer');
  assert.equal(data.price, 8999);
  assert.equal(data.characteristics['Ширина'], '389 мм');
  const empty = await client.callTool({name: 'dns_product', arguments: {product: 'https://www.dns-shop.ru/product/f4c6689d51faed20/empty/'}});
  assert.deepEqual(JSON.parse(empty.content[0].text).characteristics, {});
  for (const slug of ['status403', 'soft403', 'captcha']) {
    const result = await client.callTool({name: 'yandex_card', arguments: {product: `https://market.yandex.ru/card/${slug}/4707220787`}});
    assert.equal(result.isError, true, `Yandex ${slug} must be a native MCP error`);
    assert.match(result.content[0].text, /HTTP 403|blocked|challenge/i);
    assert.doesNotMatch(result.content[0].text, /"price"|"characteristics"/);
  }
  const yandex = await client.callTool({name: 'yandex_card', arguments: {product: 'https://market.yandex.ru/card/yandex-good/4707220787'}});
  assert(!yandex.isError);
  assert.equal(JSON.parse(yandex.content[0].text).name, 'Стол кухонный');
  console.log('Native DNS/Yandex MCP blocked-page and ordinary-card regressions passed');
} finally {
  await client.close();
  await rm(folder, {recursive: true, force: true});
}
