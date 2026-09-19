# Установка в VS Code (GitHub Copilot, agent mode)

У VS Code два отличия от остальных: верхний ключ — `servers` (а не `mcpServers`), и нужно поле `"type": "stdio"`.

Нужен VS Code 1.99+ и включённый agent mode у Copilot.

## Путь к файлу

- В проекте: `.vscode/mcp.json` (можно коммитить в git)
- Глобально: палитра команд → `MCP: Open User Configuration`

## Конфигурация

```json
{
  "servers": {
    "market": {
      "type": "stdio",
      "command": "node",
      "args": ["/полный/путь/market-mcp/src/index.js"]
    }
  }
}
```

После сохранения над блоком сервера появится кнопка Start. Инструменты доступны в Copilot Chat в режиме Agent.
