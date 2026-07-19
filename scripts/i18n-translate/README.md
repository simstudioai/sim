# i18n translator

Translates `apps/sim/messages/en/*.json` → `messages/ru/*` and `messages/de/*`
using a local LLM by default.

## One-command local pipeline

```bash
# 1. extract hardcoded client strings into en/auto.json
# 2. complete en/*.json for every namespace/key seen in ru/de
# 3. translate complete en catalogs to ru + de through local Ollama
bun run i18n:all

# dry-run the extractor without writing or translating
bun run i18n:all:dry
```

Defaults:
- extraction targets: `apps/sim/app`, `apps/sim/components`
- translation backend: Ollama at `OLLAMA_HOST_URL` or `http://127.0.0.1:11434`
- model: `OLLAMA_MODEL` or `qwen2.5:3b`
- languages: `ru,de`
- English source preparation scans `en` plus the target locale directories and
  fills missing `en` namespaces/keys before target-language translation.

Examples:

```bash
bun run i18n:all --target apps/sim/app/chat --only auto
bun run i18n:all --lang ru --limit 50
OLLAMA_MODEL=translategemma:latest bun run i18n:all
```

## Catalog-only translation

```bash
# all namespaces, ru + de, local Ollama
bun run i18n:translate

# one namespace first to sanity-check quality/speed
bun run scripts/i18n-translate/run.ts --only nav

# a single language
bun run scripts/i18n-translate/run.ts --lang ru
```

## Optional Apple backend

Apple Foundation Models can still be used explicitly. It requires Apple Intelligence:

Enable Apple Intelligence:
**System Settings → Apple Intelligence & Siri → turn on Apple Intelligence.**
(On Apple Silicon, macOS 26+.) Verify with:

```bash
swift scripts/i18n-translate/probe.swift   # prints "availability: available" + a sample RU translation
```

```bash
bun run scripts/i18n-translate/run.ts --backend apple
```

## How it works

- `scripts/i18n-local-all.ts` — orchestrates extraction + local translation.
- `scripts/i18n-prepare-en.ts` — makes `apps/sim/messages/en` complete before target translation.
- `scripts/i18n-migrate/extract.ts` — codemod that extracts client component strings into `messages/en/auto.json`.
- `run.ts` — flattens each `en` namespace, streams all string leaves through the selected translator, rebuilds the same key structure, writes the target locale file.
- `translate.swift "Russian"` — optional Apple backend; loads the model once, reads one
  English string per stdin line, prints one translation per line. Preserves
  `{placeholder}` tokens, HTML/markdown, URLs, and the product name "Sim".

## Scope

This fills the **message catalogs** for every current English namespace. It does NOT
automatically guarantee every hardcoded string is safely migrated. The combined
`i18n:all` command uses the safer staged extractor and should still be followed by
type-check/build verification after large batches.
