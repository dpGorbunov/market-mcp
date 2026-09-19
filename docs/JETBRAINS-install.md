# Установка в JetBrains AI Assistant

У AI Assistant нет файла конфигурации — всё настраивается через интерфейс. Работает в IntelliJ IDEA, PyCharm, WebStorm и других IDE JetBrains.

## Через интерфейс

1. Settings → Tools → AI Assistant → Model Context Protocol (MCP).
2. Add.
3. Вставьте JSON:

```json
{
  "command": "node",
  "args": ["/полный/путь/market-mcp/src/index.js"]
}
```

4. Apply.

Кнопка "Import from Claude" импортирует конфиг из `claude_desktop_config.json` целиком — если сервер уже настроен в Claude Desktop, проще нажать её.

У JetBrains есть отдельный CLI-агент Junie с файловым конфигом — для него смотрите [JUNIE-install.md](JUNIE-install.md).
