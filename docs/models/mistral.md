# Mistral Provider Validation — Final Pass

- **Date:** 2026-06-11
- **Scope:** All 27 entries of the `mistral` provider block in `apps/sim/providers/models.ts` (lines ~2124–2501), re-verifying everything including the changes landed in PR #4990 (7 deprecations, 8 releaseDate fixes, updatedAt bumps).
- **Method:** Live fetches of Mistral docs (model overview, model cards, pricing page, prompt-caching guide), direct download + grep of the canonical OpenAPI spec, and — decisively — the **server-side model-card source data** in `mistralai/platform-docs-public` (`src/schema/models/models/*.ts`, shallow-cloned at `main` on 2026-06-11). These TypeScript data files are what docs.mistral.ai renders into the model cards, and they carry `apiNames` (alias mappings), prices, context lengths, release dates, and `deprecationDate`/`retirementDate` metadata that the rendered pages omit. OpenRouter used as the secondary pricing source.

## Sources

| Source | URL |
|---|---|
| Models overview | https://docs.mistral.ai/getting-started/models/models_overview |
| Pricing page | https://mistral.ai/pricing |
| Model cards | https://docs.mistral.ai/models/model-cards/&lt;slug&gt; (slugs cited per model below) |
| Model-card source data (authoritative) | https://github.com/mistralai/platform-docs-public — `src/schema/models/models/*.ts` @ `main`, 2026-06-11 |
| OpenAPI spec | https://raw.githubusercontent.com/mistralai/platform-docs-public/main/openapi.yaml |
| Prompt caching guide | https://docs.mistral.ai/studio-api/conversations/advanced/prompt-caching |
| OpenRouter (secondary pricing) | https://openrouter.ai/mistralai/&lt;slug&gt; |

Below, "data file" = the model's source file in `src/schema/models/models/`.

---

## Per-model verification

### mistral-large-latest / mistral-large-2512 (Mistral Large 3, 25.12)

Data file: `mistral-large-3-25-12.ts`. Model card: `/models/model-cards/mistral-large-3-25-12`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.5 / 1.5 | $0.5 / $1.5 per 1M | Data file, model card, pricing page ("Mistral Large 3: $0.5 / $1.5"), OpenRouter `mistral-large-2512` ($0.50/$1.50) | ✓ |
| contextWindow | 256000 | 256k | Data file `contextLength: '256k'`; OpenRouter shows 262K (same window, binary units) | ✓ |
| releaseDate | 2025-12-02 | 2025-12-02 | Data file `releaseDate: '2025-12-02'` | ✓ |
| alias | latest → 2512 | `apiNames: ['mistral-large-2512', 'mistral-large-latest']` | Data file | ✓ |
| status | active | `status: 'Active'` | Data file | ✓ |
| temperature | {0, 1} | spec allows {0, **1.5**} | OpenAPI `ChatCompletionRequest.temperature` | ✗ see Changes |
| recommended | (absent) | provider default, flagship | — | ✗ see Changes |

Note: an initial pricing-page fetch summarized Large 3 as $2/$6; a verbatim re-fetch showed that was a summarization error — the literal row is "$0.5 / $1.5 /M tokens". $2/$6 is the legacy mistral-large-2411 price.

### mistral-small-2603 / mistral-small-latest (Mistral Small 4, 26.03) — CONFLICT RULING

Data file: `mistral-small-4-0-26-03.ts`. Model card: `/models/model-cards/mistral-small-4-0-26-03`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.15 / 0.6 | **$0.15 / $0.6** (ruling below) | Data file (`price: 0.15` / `price: 0.6`), model card, OpenRouter `mistral-small-2603` ($0.15/$0.60) | ✓ KEEP |
| contextWindow | 256000 | 256k | Data file | ✓ |
| releaseDate | 2026-03-16 | 2026-03-16 | Data file | ✓ |
| alias | latest → 2603 | `apiNames: ['mistral-small-2603', 'mistral-small-latest']` | Data file | ✓ |
| status | active | `status: 'Active'` | Data file | ✓ |

**Ruling on the open price conflict (question a):** mistral.ai/pricing again printed "$0.1 / $0.3" for Mistral Small 4 (verbatim re-fetch, third consistent reading). But three independent confirmations say $0.15/$0.6: (1) the model card, (2) the model-card **source data file** that drives docs billing-side documentation, and (3) OpenRouter's Mistral endpoint, which mirrors what Mistral actually charges resellers. $0.1/$0.3 is exactly the price of the predecessor Mistral Small 3.2 (`mistral-small-2506`, verified below), so the pricing-page row is almost certainly a stale carry-over from Small 3.x, not a price cut. **Final value: 0.15 / 0.6 — no change.** Re-check if the pricing page row persists alongside an official price-cut announcement.

### devstral-2512 / devstral-latest (Devstral 2, 25.12)

Data file: `devstral-2-25-12.ts`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.4 / 2.0 | $0.4 / $2 | Data file, pricing page ("Devstral 2: $0.4 / $2"), OpenRouter `devstral-2512` ($0.40/$2.00) | ✓ |
| contextWindow | 256000 | 256k | Data file | ✓ |
| releaseDate | 2025-12-09 | 2025-12-09 | Data file | ✓ |
| alias | devstral-latest → 2512 | `apiNames: ['devstral-2512', 'devstral-latest', 'devstral-medium-latest']` | Data file | ✓ (note: `devstral-medium-latest` is a third alias we don't list — fine) |
| status | active | `status: 'Active'` | Data file | ✓ |

### mistral-large-2411 (deprecated)

Data file: `mistral-large-2-1-24-11.ts`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 2.0 / 6.0 | $2.0 / $6.0 | Data file (previously unverifiable — now confirmed) | ✓ |
| contextWindow | 128000 | 128k | Data file | ✓ |
| releaseDate | 2024-11-18 | 2024-11-18 | Data file | ✓ |
| deprecated | true | `status: 'Deprecated'`, deprecationDate 2026-02-27, retirementDate 2026-05-31 (already retired) | Data file metadata | ✓ |

### magistral-medium-latest / magistral-medium-2509

Data file: `magistral-medium-1-2-25-09.ts`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 2.0 / 5.0 | $2.0 / $5.0 | Data file, pricing page ("Magistral Medium: $2 / $5") | ✓ (OpenRouter: not listed — single-family source) |
| contextWindow | 128000 | 128k | Data file | ✓ |
| releaseDate | 2025-09-18 | 2025-09-18 | Data file (PR #4990 fix confirmed) | ✓ |
| alias | latest → 2509 | `apiNames: ['magistral-medium-2509', 'magistral-medium-latest']` | Data file | ✓ |
| status | active | `status: 'Active'` | Data file | ✓ |

Note: Magistral is a reasoning model (`output: ['reasoning', 'text']`); see "Deliberately not changed" re `reasoning_effort`.

### magistral-small-latest / magistral-small-2509 (deprecated)

Data file: `magistral-small-1-2-25-09.ts`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.5 / 1.5 | $0.5 / $1.5 | Data file, pricing page | ✓ |
| contextWindow | 128000 | 128k | Data file | ✓ |
| releaseDate | 2025-09-18 | 2025-09-18 | Data file (PR #4990 fix confirmed) | ✓ |
| alias | small-latest → 2509 | `apiNames: ['magistral-small-2509', 'magistral-small-latest']` | Data file | ✓ |
| deprecated | true | `status: 'Deprecated'`, deprecationDate 2026-04-30 (past), retirementDate 2026-07-31, replacement "Mistral Small 4" | Data file metadata | ✓ |

### mistral-medium-latest / mistral-medium-2508 (Mistral Medium 3.1)

Data file: `mistral-medium-3-1-25-08.ts`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.4 / 2.0 | $0.4 / $2.0 | Data file | ✓ |
| contextWindow | 128000 | 128k | Data file | ✓ |
| releaseDate | 2025-08-12 | 2025-08-12 | Data file | ✓ |
| alias | latest → 2508 | `apiNames: ['mistral-medium-2508', 'mistral-medium-latest']` | Data file | ✓ — **`mistral-medium-latest` still maps to 2508, NOT to Medium 3.5** (3.5 has its own apiNames, see below) |
| status | active | `status: 'Active'` | Data file | ✓ |

### mistral-medium-2505 (Mistral Medium 3)

Data file: `mistral-medium-3-25-05.ts`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.4 / 2.0 | $0.4 / $2.0 | Data file | ✓ |
| contextWindow | 128000 | 128k | Data file | ✓ |
| releaseDate | 2025-05-07 | 2025-05-07 | Data file | ✓ |
| status | active (no flag) | `status: 'Active'` — not deprecated despite age | Data file | ✓ |

### mistral-small-2506 (Mistral Small 3.2, deprecated)

Data file: `mistral-small-3-2-25-06.ts`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.1 / 0.3 | $0.1 / $0.3 | Data file (previously unverifiable — now confirmed) | ✓ |
| contextWindow | 128000 | 128k | Data file | ✓ |
| releaseDate | 2025-06-20 | 2025-06-20 | Data file | ✓ |
| deprecated | true | `status: 'Deprecated'`, deprecationDate 2026-04-30 (past), retirementDate 2026-07-31 | Data file metadata | ✓ |

### open-mistral-nemo

Data file: `mistral-nemo-12b-24-07.ts`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.15 / 0.15 | $0.15 / $0.15 | Data file, pricing page ("Mistral NeMo: $0.15 / $0.15") | ✓ |
| contextWindow | 128000 | 128k | Data file | ✓ |
| releaseDate | 2024-07-18 | 2024-07-18 | Data file | ✓ |
| status | active (no flag) | `status: 'Active'` — still active | Data file | ✓ |

### codestral-latest / codestral-2508

Data file: `codestral-25-08.ts`. Model card: `/models/model-cards/codestral-25-08`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.3 / 0.9 | $0.3 / $0.9 | Data file, model card, pricing page, OpenRouter `codestral-2508` ($0.30/$0.90) | ✓ |
| contextWindow | 128000 | 128k per Mistral docs (data file + live model card). OpenRouter claims 256K — **Mistral docs win**, keep 128000 | Data file, model card | ✓ |
| releaseDate | 2025-07-30 | 2025-07-30 | Data file | ✓ |
| alias | latest → 2508 | `apiNames: ['codestral-2508', 'codestral-latest']` | Data file | ✓ |
| status | active | `status: 'Active'` | Data file | ✓ |

### devstral-small-latest (Devstral Small 2, 25.12, deprecated)

Data file: `devstral-small-2-25-12.ts`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.1 / 0.3 | $0.1 / $0.3 | Data file | ✓ |
| contextWindow | 256000 | 256k | Data file | ✓ |
| releaseDate | 2025-12-09 | 2025-12-09 | Data file (PR #4990 fix confirmed) | ✓ |
| alias | — | `apiNames: ['labs-devstral-small-2512', 'devstral-small-latest']` | Data file | ✓ |
| deprecated | true | `status: 'Deprecated'`, deprecationDate 2026-02-27, retirementDate 2026-03-31 (already retired), replacement "Devstral 2" | Data file metadata | ✓ |

### devstral-small-2507 (deprecated)

Data file: `devstral-small-1-1-25-07.ts`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.1 / 0.3 | $0.1 / $0.3 | Data file (previously unverifiable — now confirmed) | ✓ |
| contextWindow | 128000 | 128k | Data file | ✓ |
| releaseDate | 2025-07-10 | 2025-07-10 | Data file | ✓ |
| deprecated | true | `status: 'Deprecated'`, deprecationDate 2026-02-27, retirementDate 2026-05-31 (already retired) | Data file metadata | ✓ |

### devstral-medium-2507 (deprecated)

Data file: `devstral-medium-1-0-25-07.ts`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.4 / 2.0 | $0.4 / $2.0 | Data file (previously unverifiable — now confirmed) | ✓ |
| contextWindow | 128000 | 128k | Data file | ✓ |
| releaseDate | 2025-07-10 | 2025-07-10 | Data file | ✓ |
| deprecated | true | `status: 'Deprecated'`, deprecationDate 2026-02-27, retirementDate 2026-05-31 (already retired) | Data file metadata | ✓ |

### ministral-14b-latest / ministral-14b-2512 (Ministral 3 14B)

Data file: `ministral-3-14b-25-12.ts`. Model card: `/models/model-cards/ministral-3-14b-25-12`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.2 / 0.2 | $0.2 / $0.2 | Data file, pricing page, OpenRouter `ministral-14b-2512` ($0.20/$0.20) | ✓ |
| contextWindow | 256000 | 256k | Data file | ✓ |
| releaseDate | 2025-12-02 | 2025-12-02 | Data file | ✓ |
| alias | latest → 2512 | `apiNames: ['ministral-14b-2512', 'ministral-14b-latest']` | Data file | ✓ |
| status | active | `status: 'Active'` | Data file | ✓ |
| speedOptimized | (absent) | edge/low-latency tier | — | ✗ see Changes |

### ministral-8b-latest / ministral-8b-2512 (Ministral 3 8B)

Data file: `ministral-3-8b-25-12.ts`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.15 / 0.15 | $0.15 / $0.15 | Data file, pricing page | ✓ |
| contextWindow | 256000 | 256k | Data file | ✓ |
| releaseDate | 2025-12-02 | 2025-12-02 | Data file (PR #4990 fix confirmed) | ✓ |
| alias | latest → 2512 | `apiNames: ['ministral-8b-2512', 'ministral-8b-latest']` | Data file | ✓ |
| speedOptimized | (absent) | edge/low-latency tier | — | ✗ see Changes |

### ministral-3b-latest / ministral-3b-2512 (Ministral 3 3B)

Data file: `ministral-3-3b-25-12.ts`.

| Field | Ours | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing input/output | 0.1 / 0.1 | $0.1 / $0.1 | Data file, pricing page | ✓ |
| contextWindow | 256000 | 256k | Data file | ✓ |
| releaseDate | 2025-12-02 | 2025-12-02 | Data file (PR #4990 fix confirmed) | ✓ |
| alias | latest → 2512 | `apiNames: ['ministral-3b-2512', 'ministral-3b-latest']` | Data file | ✓ |
| speedOptimized | (absent) | edge/low-latency tier | — | ✗ see Changes |

---

## Provider-wide checks

### Temperature bounds (question e) — DISCREPANCY FOUND

The live OpenAPI spec's `ChatCompletionRequest.temperature` (openapi.yaml, schema at line 11988, property at 11997) is:

```yaml
temperature:
  anyOf:
  - type: number
    maximum: 1.5
    minimum: 0
```

with the description "we recommend between 0.0 and 0.7". So the chat-completions endpoint — the one Sim's provider calls (`https://api.mistral.ai/v1` + `chat.completions.create`) — accepts **0–1.5, not 0–1**. The 0–1 bound exists in the spec only on `CompletionArgs` (line ~8103), which is the **conversations/agents API**'s white-listed argument schema, not chat completions; that is likely where the earlier "max 1" belief came from. Verdict: our `{min: 0, max: 1}` is overly restrictive — users cannot select 1.0–1.5, which the API supports. Recommended fix: `max: 1.5` on all 27 entries.

### Prompt caching (question b) — NOT WIRED, cachedInput NOT added

- OpenAPI spec: `prompt_cache_key` exists on `ChatCompletionRequest` (line 12134), `FIMCompletionRequest` (12362), and `AgentsCompletionRequest` (13841): "A cache key to enable prompt caching. When provided, the API will attempt to reuse previously computed tokens... Cached tokens are billed at 10% of the standard input token price."
- Prompt-caching guide confirms caching is **opt-in**: "Set the same `prompt_cache_key` on requests that are likely to share a prefix"; 64-token block granularity; hits reported via `usage.prompt_tokens_details.cached_tokens`.
- Sim's provider (`apps/sim/providers/mistral/index.ts`) forwards only `temperature` and `max_tokens` (plus messages/tools/response_format). It does **not** send `prompt_cache_key`, so no Sim request can ever produce cached tokens.

**Ruling: caching is opt-in, Sim does not opt in → adding `cachedInput` would be dead data. Not changed.** Recommended follow-up: wire `prompt_cache_key` in the Mistral provider (e.g. keyed per workflow execution/conversation), read `usage.prompt_tokens_details.cached_tokens`, then add `cachedInput = 0.1 × input` to all active entries (large 0.05, small 0.015, devstral 0.04, magistral-medium 0.2, medium 0.04, nemo 0.015, codestral 0.03, ministral-14b 0.02, ministral-8b 0.015, ministral-3b 0.01).

### recommended / speedOptimized (question c) — BOTH JUSTIFIED

- `recommended: true` on **mistral-large-latest**: it is the provider's `defaultModel`, Mistral's flagship generalist (Large 3), actively maintained, and the provider currently has zero recommended entries (every other major provider block marks its flagship). Justified.
- `speedOptimized: true` on the **ministral tier** (14b/8b/3b, `-latest` and `-2512`, 6 entries): Ministral 3 is Mistral's edge/low-latency family ("les Ministraux" — edge models), the smallest and cheapest tier, directly analogous to the existing `speedOptimized` entries in models.ts (gpt-5-mini-class at line ~369, Haiku at line ~853). Justified.

### Alias map (question g) — ALL CONFIRMED

| Alias | Expected | Data-file `apiNames` | Verdict |
|---|---|---|---|
| mistral-large-latest | mistral-large-2512 | ✓ | ✓ |
| mistral-small-latest | mistral-small-2603 | ✓ | ✓ |
| codestral-latest | codestral-2508 | ✓ | ✓ |
| devstral-latest | devstral-2512 | ✓ (also `devstral-medium-latest`) | ✓ |
| devstral-small-latest | labs-devstral-small-2512 (Devstral Small 2) | ✓ | ✓ |
| magistral-medium-latest | magistral-medium-2509 | ✓ | ✓ |
| magistral-small-latest | magistral-small-2509 | ✓ | ✓ |
| mistral-medium-latest | mistral-medium-2508 (NOT Medium 3.5) | ✓ | ✓ |
| ministral-14b/8b/3b-latest | ministral-*-2512 | ✓ | ✓ |

---

## Changes made in this pass

None to `models.ts` (per instructions, this pass writes only this document). The PR #4990 changes (7 deprecations, 8 releaseDate fixes) are all **confirmed correct** against the model-card source data.

**Recommended fixes (the fix list):**

1. `mistral-large-latest`: add `recommended: true` — provider default + flagship; provider has zero recommended entries.
2. `ministral-14b-latest`, `ministral-14b-2512`, `ministral-8b-latest`, `ministral-8b-2512`, `ministral-3b-latest`, `ministral-3b-2512`: add `speedOptimized: true` — edge/low-latency tier, consistent with gpt-mini/haiku precedent.
3. All 27 entries: `capabilities.temperature.max` 1 → **1.5** — OpenAPI `ChatCompletionRequest.temperature.maximum: 1.5`. (The 0–1 bound belongs to the conversations-API `CompletionArgs`, not chat completions. If the team prefers to cap the UI at Mistral's recommended sampling range instead of the API bound, keep 1 — but then document that choice; it does not match the endpoint Sim calls.)

## Deliberately not changed

- **mistral-small-2603 / mistral-small-latest pricing stays 0.15/0.6** — final ruling on the standing conflict: model card + model-card source data + OpenRouter all say $0.15/$0.6; only the marketing pricing page says $0.1/$0.3, which exactly equals the predecessor Small 3.2 price and is judged a stale row, not a price cut.
- **No `cachedInput` on any entry** — Mistral caching is opt-in via `prompt_cache_key` and Sim's provider does not send it; adding prices would be dead data. Requires provider wiring first (recommended follow-up above).
- **`mistral-medium-2505` left active** — `status: 'Active'` in source data, no deprecation metadata despite Medium 3.1/3.5 existing.
- **`open-mistral-nemo` left active** — still `status: 'Active'`.
- **codestral contextWindow stays 128000** — OpenRouter claims 256K but both the live model card and the source data say 128k; Mistral docs win.
- **`updatedAt: '2026-04-01'` left on deprecated entries** — their prices were verified unchanged; only active entries were bumped in PR #4990 and that remains coherent.
- **Reasoning params not wired** — spec exposes `reasoning_effort` (`high`/`none`) on `ChatCompletionRequest` (line 12119; `prompt_mode` is deprecated in its favor). Sim doesn't forward it, so no capabilities change; note for a future Magistral reasoning integration.
- **mistral-medium-3-5 NOT added in this pass** (documented as a recommended addition, question d): Mistral Medium 3.5 — `apiNames: ['mistral-medium-3-5', 'mistral-medium-3']`, released **2026-04-28**, **$1.5 / $7.5** per 1M (data file `mistral-medium-3-5-26-04.ts` + pricing page agree), **256k** context, Active, "frontier-class multimodal model optimized for agentic and coding". Matches existing `/^mistral/` modelPattern, so adding the entry is sufficient. Note its id does not follow the `-MMYY` convention — both apiNames could be listed if desired.

## Unverifiable

Nothing remains strictly unverifiable. The four previously-unverifiable legacy prices (mistral-large-2411 2.0/6.0, mistral-small-2506 0.1/0.3, devstral-small-2507 0.1/0.3, devstral-medium-2507 0.4/2.0) are now **confirmed** via the model-card source data files. Caveats:

- `magistral-medium-2509` pricing has no independent second source (not listed on OpenRouter); verified only within the Mistral doc family (data file + pricing page, which agree).
- The Mistral Small 4 pricing-page row ($0.1/$0.3) remains in live contradiction with the model card; ruling above. Re-check on the next pass.
