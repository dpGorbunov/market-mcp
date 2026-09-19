# Установка в OpenAI Codex CLI

Codex использует формат TOML, а не JSON.

## Путь к файлу

- Глобально: `~/.codex/config.toml`
- В проекте: `.codex/config.toml`

## Конфигурация

```toml
[mcp_servers.market]
command = "node"
args = ["/полный/путь/market-mcp/src/index.js"]
```

## Через CLI

```bash
codex mcp add market -- node /полный/путь/market-mcp/src/index.js
codex mcp list
```

Если сервера нет в списке, перезапустить Codex или запустить `codex --mcp-debug`.

## Первый запуск

Сервер открывает окно Chromium с постоянным профилем `~/.market-mcp/profile`. Ozon, DNS и Маркет проверяют браузер один раз, cookies сохраняются. Если показана капча, окно ждёт до 120 с, пока её решит человек. Окно не закрывать, оно само закроется через 10 минут простоя.

## Как агенту пользоваться инструментами

См. `docs/AGENT-GUIDE.md`. Тот же текст можно вставить в `AGENTS.md` проекта, чтобы Codex применял его сам.
