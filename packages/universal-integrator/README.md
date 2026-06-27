# @sim/universal-integrator

Универсальный агент на **Claude Agent SDK**: любой сервис (URL / имя / SDK) →
ПОЛНАЯ интеграция для `apps/sim` (Block + все Tools), покрывающая весь API.
Пропуск методов запрещён правилами агента (`sum(methods) == endpointCount`,
неизвестные endpoint'ы → TODO, не выдумываются).

## Запуск

Из корня монорепо:

```bash
bun install                         # один раз — подтянет @anthropic-ai/claude-agent-sdk
export ANTHROPIC_API_KEY=sk-ant-...

bun run integrate 'Stripe'
bun run integrate 'https://core.telegram.org/bots/api'
bun run integrate 'https://apidocs.bitrix24.com'
bun run integrate 'Slack'           # OAuth2 → агент создаст oauth-input + hidden token
```

`bun run integrate` запускается из корня репо, поэтому агент пишет прямо в
`apps/sim/...` (cwd = корень → `--sim-repo` по умолчанию = корень).

### Опции

```
bun run integrate <service> [options]
  --sim-repo <path>   путь к репо sim (по умолчанию cwd)
  --dry-run           писать в --out, а не в репо
  --out <dir>         каталог для dry-run (по умолчанию ./generated)
  --verbose | -v      показывать I/O инструментов
```

Безопасная проверка без записи в репо:

```bash
bun run integrate 'Stripe' --dry-run --out ./generated --verbose
```

## Что делает агент (фазы)

| Фаза | Действие |
|------|----------|
| 0 PROBE | классифицирует сервис: spec / sdk / форма доки / auth-модель / события |
| 1 INGEST | выбирает тир извлечения (OpenAPI / llms.txt / single-page / multi-page / SDK), опц. `bunx`-ускорители с нативным fallback |
| 2 INVENTORY | сводит весь API в `/tmp/api-inventory.json`, фиксирует `endpointCount` и полное покрытие |
| 3 DESIGN | маппит каждую возможность API на правильную конструкцию sim.ai (auth, subBlock-типы, condition, триггеры, файлы, пагинация) |
| 4 CODEGEN | пишет `tools/{provider}/*`, `blocks/blocks/{provider}.ts`, иконку, при необходимости route'ы и триггеры; регистрирует в реестрах |
| 5 VALIDATE | `tsc --noEmit`, сверка покрытия, консистентность ID, проверка секретов |
| 6 REPORT | отчёт: покрытие, выбранные конструкции, TODO, git/PR-команды |

## Структура

```
src/
├── index.ts             agent runner (Claude Agent SDK)
├── args.ts              CLI
├── printer.ts           вывод
├── sim-capabilities.ts  полная карта возможностей sim.ai (инжектится в промпт)
└── prompt.ts            мозг: probe → ingest → inventory → design → codegen → validate → report
```

## Требования

- `bun`, Node 20+
- `ANTHROPIC_API_KEY` в окружении
- Единственная жёсткая зависимость — `@anthropic-ai/claude-agent-sdk`.
  Парсеры/краулеры (firecrawl, openapi-typescript, cheerio, simple-icons …) агент
  запускает по необходимости через `bunx --yes`, в репо они не добавляются.
