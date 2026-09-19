# Установка в Cursor

## Путь к файлу

- Глобально: `~/.cursor/mcp.json`
- В проекте: `.cursor/mcp.json`

Открыть через интерфейс: Cursor Settings → Tools & MCP → New MCP Server.

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

Поле `"type": "stdio"` указывать не нужно — оно определяется автоматически при наличии `command`.

После сохранения сервер появится в списке в Settings → Tools & MCP с зелёным индикатором.
