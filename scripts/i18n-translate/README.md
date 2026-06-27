# i18n translator (Apple Foundation Models, on-device)

Translates `apps/sim/messages/en/*.json` → `messages/ru/*` and `messages/de/*`
using Apple's on-device LLM (Apple Intelligence). No network, no API key.

## Prerequisite (one-time, user action)

Enable Apple Intelligence:
**System Settings → Apple Intelligence & Siri → turn on Apple Intelligence.**
(On Apple Silicon, macOS 26+.) Verify with:

```bash
swift scripts/i18n-translate/probe.swift   # prints "availability: available" + a sample RU translation
```

## Run

```bash
# one namespace first to sanity-check quality/speed
bun run scripts/i18n-translate/run.ts --only nav

# a single language
bun run scripts/i18n-translate/run.ts --lang ru

# everything (all namespaces, ru + de)
bun run scripts/i18n-translate/run.ts
```

## How it works

- `translate.swift "Russian"` — long-lived process; loads the model once, reads one
  English string per stdin line, prints one translation per line. Preserves
  `{placeholder}` tokens, HTML/markdown, URLs, and the product name "Sim".
- `run.ts` — flattens each `en` namespace, streams all string leaves through the
  Swift translator, rebuilds the same key structure, writes the target locale file.

## Scope

This fills the **message catalogs** (the 17 next-intl namespaces). It does NOT
extract hardcoded strings from the ~799 components that don't yet use
`useTranslations` — that is a separate, staged migration (per namespace/feature,
verified each batch) to avoid breaking JSX/builds.
