# Установка в Claude Code

Самый быстрый способ — команда `claude mcp add`. После `--` идёт команда запуска сервера как есть.

## Через CLI

Глобально (во всех проектах):

```bash
claude mcp add market --scope user -- node /полный/путь/market-mcp/src/index.js
```

Только в текущем проекте (запишется в `.mcp.json`, можно коммитить в git):

```bash
claude mcp add market --scope project -- node /полный/путь/market-mcp/src/index.js
```

## Вручную через .mcp.json

Файл `.mcp.json` в корне проекта:

```json
{
  "mcpServers": {
    "market": {
      "command": "node",
      "args": ["/полный/путь/market-mcp/src/index.js"]
    }
  }
}
```

## Проверка

```bash
claude mcp list
```

Сервер с проектным scope требует одобрения при первом запуске `claude` в папке проекта. Подтвердите — появятся три инструмента: `ozon_search`, `ozon_product_details`, `ozon_product_reviews`.

Удалить:

```bash
claude mcp remove ozon
```
