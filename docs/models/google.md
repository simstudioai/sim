# Google Provider Model Validation — Final Pass

- **Date:** 2026-06-11
- **Scope:** `google` block in `apps/sim/providers/models.ts` (10 models), re-verifying everything including changes landed in PR #4990
- **Method:** Live WebFetch of ai.google.dev (models overview, per-model pages, pricing, thinking, deprecations, changelog, generate-content API reference) and cloud.google.com Vertex AI pricing; OpenRouter as secondary pricing source; WebSearch for GA dates. Google docs treated as authoritative where sources conflict.
- **Primary sources:**
  - https://ai.google.dev/gemini-api/docs/models (+ per-model pages)
  - https://ai.google.dev/gemini-api/docs/pricing
  - https://ai.google.dev/gemini-api/docs/thinking
  - https://ai.google.dev/gemini-api/docs/deprecations
  - https://ai.google.dev/gemini-api/docs/changelog
  - https://ai.google.dev/gemini-api/docs/interactions/deep-research
  - https://ai.google.dev/api/generate-content (GenerationConfig)
  - https://cloud.google.com/vertex-ai/generative-ai/pricing ("Gemini Deep Research Agent" row)
  - OpenRouter model pages (secondary pricing)

## Provider-level checks

| Check | Result |
|---|---|
| Capability consumption in `apps/sim/providers/gemini/` | Only `thinking` is consumed: `request.thinkingLevel` → `mapToThinkingLevel` → `thinkingConfig` (`gemini/core.ts:955-961`). No references to `reasoningEffort`, `verbosity`, `nativeStructuredOutputs`, or `computerUse`. Declaring `thinking.levels`/`default` per model is the only capability surface that affects requests. |
| `temperature: { min: 0, max: 2 }` | **Verified.** GenerationConfig documents temperature range [0.0, 2.0] (https://ai.google.dev/api/generate-content). Note Google recommends keeping 1.0 default on Gemini 3 models, but 0–2 is the accepted API range. Verdict: correct on all entries. |
| 2.5-series entries have no `thinking` capability | **Correct by design.** Gemini 2.5 uses `thinkingBudget`, not `thinkingLevel` (https://ai.google.dev/gemini-api/docs/thinking). Our provider only sends `thinkingConfig` when a level is selected, so omitting `thinking` on 2.5 entries is right. |

## Per-model verification

### gemini-3.5-flash

| Field | Our value | Source | Verdict |
|---|---|---|---|
| id | `gemini-3.5-flash` (stable/GA) | docs/models, model page | OK |
| pricing.input | 1.5 | docs/pricing ($1.50); Vertex ($1.50 global); OpenRouter ($1.50) | OK |
| pricing.cachedInput | 0.15 | docs/pricing ($0.15); Vertex ($0.15) | OK |
| pricing.output | 9.0 | docs/pricing ($9.00); Vertex ($9.00); OpenRouter ($9.00) | OK |
| thinking.levels | minimal/low/medium/high | docs/thinking | OK |
| thinking.default | medium | docs/thinking ("Default: medium"); OpenRouter ("defaults to medium thinking effort") | OK |
| maxOutputTokens | 65536 | model page (65,536) | OK |
| contextWindow | 1048576 | model page (1,048,576) | OK |
| releaseDate | 2026-05-19 | changelog: "May 19, 2026 — Released `gemini-3.5-flash`, the generally available (GA) version" | OK |
| recommended | true | Google's flagship recommendation; replacement target for 2.0-flash and 3-flash-preview | OK |

### gemini-3.1-pro-preview

| Field | Our value | Source | Verdict |
|---|---|---|---|
| id | `gemini-3.1-pro-preview` | docs/models, model page | OK |
| pricing.input | 2.0 | docs/pricing ($2.00 ≤200k; $4.00 >200k); OpenRouter ($2) | OK (base tier; see "Deliberately not changed") |
| pricing.cachedInput | 0.2 | docs/pricing ($0.20 ≤200k) | OK |
| pricing.output | 12.0 | docs/pricing ($12.00 ≤200k; $18.00 >200k); OpenRouter ($12) | OK |
| thinking.levels | low/medium/high (no minimal — PR #4990 change) | docs/thinking: "Supported levels: low, medium, high"; "Thinking cannot be disabled" | OK — #4990 change re-confirmed |
| thinking.default | high | docs/thinking ("Default: high (dynamic)") | OK |
| maxOutputTokens | 65536 | model page | OK |
| contextWindow | 1048576 | model page (1,048,576) | OK |
| releaseDate | 2026-02-19 | changelog: "Feb 19, 2026 — Released Gemini 3.1 Pro Preview" | OK |

### gemini-3.1-flash-lite

| Field | Our value | Source | Verdict |
|---|---|---|---|
| id | `gemini-3.1-flash-lite` (stable — PR #4990 rename) | docs/models lists stable; `gemini-3.1-flash-lite-preview` marked "Shut down" (May 25, 2026 per deprecations) | OK — rename re-confirmed |
| pricing.input | 0.25 | docs/pricing ($0.25 text); Vertex ($0.25 global); OpenRouter ($0.25) | OK |
| pricing.cachedInput | 0.025 | docs/pricing ($0.025); Vertex ($0.025) | OK |
| pricing.output | 1.5 | docs/pricing ($1.50); Vertex ($1.50); OpenRouter ($1.50) | OK |
| thinking.levels | minimal/low/medium/high | docs/thinking; OpenRouter ("full thinking levels (minimal, low, medium, high)") | OK |
| thinking.default | minimal | docs/thinking: "Default: minimal" — Google's documented API default for this model **is** `minimal`, so our value matches the API default (the earlier report that the API default is 'high' is not supported by current docs). Also aligns with our cost-saving intent. | OK |
| maxOutputTokens | 65536 | model page (65,536) | OK |
| contextWindow | 1048576 | model page (1,048,576) | OK |
| releaseDate | **2026-03-03 — STALE.** That is the preview's release date. GA changelog: "May 7, 2026 — Released `gemini-3.1-flash-lite`, the generally available (GA) version"; Google Cloud blog GA announcement published 2026-05-08. Changelog (Gemini API source of truth) wins. | changelog; cloud.google.com blog "Gemini 3.1 Flash-Lite is now generally available" | **FIX → 2026-05-07** |
| speedOptimized | (absent) | Model page: "optimized for low-latency, cost-effective" high-volume tasks; Google blog: "fastest and most cost-efficient Gemini 3 series model". Precedent: `gemini-2.5-flash-lite` carries `speedOptimized: true` and Google's models page calls 2.5-flash-lite "the fastest and most budget-friendly" of its generation — 3.1-flash-lite holds the same position in the Gemini 3 generation. | **FIX → add `speedOptimized: true`** |

### gemini-3-flash-preview

| Field | Our value | Source | Verdict |
|---|---|---|---|
| id | `gemini-3-flash-preview` | docs/models, model page | OK |
| pricing.input | 0.5 | docs/pricing ($0.50 text); OpenRouter ($0.50) | OK |
| pricing.cachedInput | 0.05 | docs/pricing ($0.05) | OK |
| pricing.output | 3.0 | docs/pricing ($3.00); OpenRouter ($3.00) | OK |
| thinking.levels | minimal/low/medium/high | docs/thinking | OK |
| thinking.default | high | docs/thinking ("Default: high (dynamic)") | OK |
| maxOutputTokens | 65536 | model page | OK |
| contextWindow | 1048576 (PR #4990 change) | model page (1,048,576); OpenRouter (1M) | OK — #4990 change re-confirmed |
| releaseDate | 2025-12-17 | changelog: "Dec 17, 2025 — Launched Gemini 3 Flash Preview"; OpenRouter | OK |
| deprecated | (absent) | docs/deprecations lists `gemini-3-flash-preview` in the deprecation table with recommended replacement `gemini-3.5-flash`, **no shutdown date announced yet**. (The model's own page still renders as an active preview — the deprecations table is the authoritative lifecycle source.) | **FIX → add `deprecated: true`** |

### gemini-2.5-pro

| Field | Our value | Source | Verdict |
|---|---|---|---|
| pricing.input | 1.25 | docs/pricing ($1.25 ≤200k); OpenRouter ($1.25) | OK (base tier) |
| pricing.cachedInput | 0.125 | docs/pricing ($0.125 ≤200k) | OK |
| pricing.output | 10.0 | docs/pricing ($10.00 ≤200k); OpenRouter ($10) | OK |
| maxOutputTokens | 65536 | longstanding model-page value | OK |
| contextWindow | 1048576 | OpenRouter (1M); longstanding model-page value | OK |
| releaseDate | 2025-03-25 | preview launch date (GA was 2025-06-17); repo convention uses first availability | OK |

### gemini-2.5-flash

| Field | Our value | Source | Verdict |
|---|---|---|---|
| pricing.input | 0.3 | docs/pricing ($0.30 text) | OK |
| pricing.cachedInput | 0.03 | docs/pricing ($0.03) | OK |
| pricing.output | 2.5 | docs/pricing ($2.50) | OK |
| maxOutputTokens / contextWindow | 65536 / 1048576 | longstanding model-page values | OK |
| releaseDate | 2025-05-20 | I/O 2025 preview launch | OK |

### gemini-2.5-flash-lite

| Field | Our value | Source | Verdict |
|---|---|---|---|
| pricing.input | 0.1 | docs/pricing ($0.10 text) | OK |
| pricing.cachedInput | 0.01 | docs/pricing ($0.01) | OK |
| pricing.output | 0.4 | docs/pricing ($0.40) | OK |
| maxOutputTokens / contextWindow | 65536 / 1048576 | longstanding model-page values | OK |
| releaseDate | 2025-06-17 | launch announcement | OK |
| speedOptimized | true | docs/models: "fastest and most budget-friendly multimodal model" | OK |

### gemini-2.0-flash (deprecated)

| Field | Our value | Source | Verdict |
|---|---|---|---|
| deprecated | true (PR #4990 change) | docs/deprecations: shutdown June 1, 2026; changelog: "now shut down"; docs/pricing marks "(deprecated; shutdown June 1, 2026)". Replacement: gemini-3.5-flash. | OK — #4990 change re-confirmed. Entry retained intentionally for saved-workflow history. |
| pricing | input 0.1 / cachedInput 0.025 / output 0.4 | docs/pricing (still published) | OK |
| maxOutputTokens / contextWindow | 8192 / 1048576 | historical model-page values | OK |
| releaseDate | 2025-02-05 | GA announcement | OK |

### gemini-2.0-flash-lite (deprecated)

| Field | Our value | Source | Verdict |
|---|---|---|---|
| deprecated | true (PR #4990 change) | docs/deprecations: shutdown June 1, 2026. Replacement: gemini-3.1-flash-lite. | OK — re-confirmed; retained for history |
| pricing | input 0.075 / output 0.3 (no cachedInput — caching was never priced for this SKU) | docs/pricing | OK |
| maxOutputTokens / contextWindow | 8192 / 1048576 | historical model-page values | OK |
| releaseDate | 2025-02-25 | GA announcement | OK |

### deep-research-pro-preview-12-2025

| Field | Our value | Source | Verdict |
|---|---|---|---|
| id | `deep-research-pro-preview-12-2025` | model page https://ai.google.dev/gemini-api/docs/models/deep-research-pro-preview-12-2025 (Interactions API) | OK |
| pricing.input | 2.0 (PR #4990) | Vertex AI pricing, "Gemini Deep Research Agent": $2/1M input | OK — re-confirmed |
| pricing.cachedInput | 0.2 (PR #4990) | Vertex AI pricing: $0.2/1M cached input | OK — re-confirmed |
| pricing.output | 12.0 (PR #4990, was 2.0) | Vertex AI pricing: $12/1M output (response and reasoning). Consistent with underlying Gemini 3.1 Pro rates ($2/$0.2/$12). | OK — re-confirmed |
| capabilities | deepResearch: true, memory: false | model page (agentic researcher; Interactions API) | OK |
| maxOutputTokens | 65536 | model page (65,536) | OK |
| contextWindow | 1048576 (PR #4990) | model page (1,048,576) | OK — re-confirmed |
| releaseDate | 2025-12-11 | model page only says "December 2025"; exact day not published in fetched docs | Unverifiable to the day; month consistent — keep |
| Lifecycle | Not listed on docs/deprecations; no shutdown announced | docs/deprecations | OK to keep |

**Recommendation (documented only, no entries added):** Google introduced `deep-research-preview-04-2026` and `deep-research-max-preview-04-2026` on 2026-04-21 (changelog; https://ai.google.dev/gemini-api/docs/interactions/deep-research). The Deep Research interactions doc now leads with these SKUs and prices them per-task (~$1–3 / ~$3–7). A follow-up should evaluate adding them once per-token pricing is published; `deep-research-pro-preview-12-2025` remains documented and un-deprecated, so no change now.

## Changes made in this pass

None to `models.ts` (per task rules — fix list reported separately). This document is the only artifact.

## Re-confirmed PR #4990 changes

1. `gemini-3.1-flash-lite-preview` → `gemini-3.1-flash-lite` rename — preview slug shut down 2026-05-25 (deprecations page); stable listed on docs/models.
2. `gemini-3.1-pro-preview` thinking.levels without `minimal` — docs/thinking lists low/medium/high only; "thinking cannot be disabled".
3. `gemini-3-flash-preview` contextWindow 1048576 — model page.
4. `deprecated: true` on gemini-2.0-flash and gemini-2.0-flash-lite — shut down 2026-06-01 (deprecations + changelog).
5. Deep Research output 12.0, cachedInput 0.2, contextWindow 1048576 — Vertex pricing row + model page.

## Recommended fixes (not applied)

1. `gemini-3.1-flash-lite`: `releaseDate` `2026-03-03` → `2026-05-07` — current value is the preview's release date; GA released May 7, 2026 per Gemini API changelog (Cloud blog announcement published May 8, 2026; changelog wins as the API source of truth).
2. `gemini-3.1-flash-lite`: add `speedOptimized: true` — Google positions it as the fastest, most cost-efficient Gemini 3 model (model page, GA blog); matches the precedent set by `gemini-2.5-flash-lite`.
3. `gemini-3-flash-preview`: add `deprecated: true` — formally listed on https://ai.google.dev/gemini-api/docs/deprecations with replacement `gemini-3.5-flash` (no shutdown date announced yet).

## Deliberately not changed

- **`gemini-3.1-flash-lite` thinking.default `minimal`** — matches Google's documented default for this model (docs/thinking: "Default: minimal") and is also our intended cost-saving default. No conflict.
- **Tiered pricing (`gemini-3.1-pro-preview`, `gemini-2.5-pro`)** — we model the ≤200k-token base tier ($2/$12 and $1.25/$10). The >200k tier ($4/$18 and $2.50/$15) is not representable in the flat pricing schema; base tier is the established repo convention.
- **Audio input pricing** (flash models have higher audio-input rates, e.g. 3.1-flash-lite $0.50 audio) — schema models text-input pricing only; convention.
- **gemini-2.0-flash / -flash-lite entries kept despite shutdown** — `deprecated: true` retained instead of deletion so saved workflows referencing them keep rendering history correctly.
- **Deep Research newer SKUs not added** — per-task preview pricing only; documented as a follow-up recommendation above.
- **`gemini-2.5-pro` releaseDate 2025-03-25** — preview-launch date; repo convention is first availability, not GA (2025-06-17).
- **`updatedAt: 2026-06-11`** on all entries — accurate as of this validation.

## Unverifiable

- **deep-research-pro-preview-12-2025 exact release day (2025-12-11)** — Google docs only state "December 2025"; the day-level value could not be confirmed or refuted. Month consistent; left as-is.
- **2.5-series maxOutputTokens (65,536) and 2.0-series limits (8,192 / 1,048,576)** — not re-fetched per-model in this pass; values match longstanding Google model-page specs and were unchanged by PR #4990. OpenRouter corroborates 1M context for 2.5-pro.
- **Gemini API pricing page for Deep Research** — the ai.google.dev pricing page does not list the 12-2025 SKU (it now points at the 04-2026 per-task estimates); per-token verification rests on the Vertex AI "Gemini Deep Research Agent" row alone (single — but official Google — source).
