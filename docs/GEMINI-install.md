# Установка в Gemini CLI

## Путь к файлу

- Глобально: `~/.gemini/settings.json`
- В проекте: `.gemini/settings.json`

## Конфигурация

```json
{
  "mcpServers": {
    "market": {
      "command": "node",
      "args": ["/полный/путь/market-mcp/src/index.js"],
      "timeout": 30000,
      "trust": false
    }
  }
}
```

`trust: false` — Gemini спросит подтверждение перед вызовом инструмента. Поставьте `true`, чтобы вызывать без подтверждения. `timeout` — в миллисекундах.

## Через CLI

```bash
gemini mcp add ozon -- node /полный/путь/market-mcp/src/index.js
```
