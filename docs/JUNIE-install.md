# Установка в Junie

Junie — отдельный агентный CLI от JetBrains, у него есть файловый конфиг (в отличие от AI Assistant).

## Путь к файлу

- Глобально: `~/.junie/mcp/mcp.json`
- В проекте: `.junie/mcp/mcp.json`

## Конфигурация

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
