# Установка в OpenAI Codex CLI

Codex использует формат TOML, а не JSON. Это единственный клиент с таким отличием.

## Путь к файлу

- Глобально: `~/.codex/config.toml`
- В проекте: `.codex/config.toml`

## Конфигурация

```toml
[mcp_servers.ozon]
command = "node"
args = ["/полный/путь/market-mcp/src/index.js"]
```

## Через CLI

```bash
codex mcp add ozon -- node /полный/путь/market-mcp/src/index.js
```

## Проверка

```bash
codex mcp list
```

В некоторых версиях Codex не подхватывает `mcp_servers` из `config.toml` сразу. Если сервера нет в списке — перезапустите Codex или запустите с `codex --mcp-debug`.
