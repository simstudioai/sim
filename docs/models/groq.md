# Groq Provider Validation — Final Pass

**Date:** 2026-06-11
**Scope:** `groq` provider block in `apps/sim/providers/models.ts` (8 models). Re-verifies everything, including the changes landed in PR #4990 (kimi `deprecated: true`, gpt-oss `cachedInput`, `updatedAt` bumps).

## Sources & Method

| Source | What it verified |
|---|---|
| `https://api.groq.com/openai/v1/models` (live, authenticated with local dev key) | Active model list, `context_window`, `max_completion_tokens`, `created` timestamps. Groq's own per-model doc pages render their spec tables client-side from this same data ("Loading model information..." in static HTML), so the API is the authoritative equivalent of the per-model pages. |
| `https://groq.com/pricing` (live fetch) | All input/cached-input/output rates |
| `https://console.groq.com/docs/prompt-caching` (live fetch) | Caching-supported model list, 50% cached-token discount |
| `https://console.groq.com/docs/deprecations` (live fetch) | kimi shutdown, qwen3-32b status |
| `https://console.groq.com/docs/models` + per-model `.md` pages (live fetch) | Featured/flagship positioning, context-window prose, model-card positioning |
| Groq OpenAPI spec embedded in `console.groq.com/docs/model/*` HTML | `temperature` parameter bounds (`minimum: 0, maximum: 2`) |
| OpenRouter `GET /api/v1/models/<slug>/endpoints` Groq rows (secondary) | Pricing cross-check, `max_completion_tokens` cross-check |
| WebSearch (Meta blog coverage, Moonshot K2-0905 announcement coverage) | Upstream release dates |

Rule applied: where Groq's own sources conflict with secondary sources, Groq wins.

## Per-Model Verification

### groq/openai/gpt-oss-120b

| Field | Repo value | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing.input | 0.15 | $0.15/M | groq.com/pricing; OpenRouter Groq row 0.00000015 | OK |
| pricing.cachedInput | 0.075 | $0.075/M | groq.com/pricing (explicit cached column); prompt-caching doc 50% rule; OpenRouter 0.000000075 | OK (PR #4990 change confirmed) |
| pricing.output | 0.6 | $0.60/M | groq.com/pricing; OpenRouter | OK |
| contextWindow | 131072 | 131072 | api.groq.com/openai/v1/models; model card "131K context window" | OK |
| capabilities.maxOutputTokens | — (absent) | 65536 | api.groq.com/openai/v1/models `max_completion_tokens`; OpenRouter agrees | **FIX: add 65536** |
| releaseDate | 2025-08-05 | 2025-08-05 | Groq API `created` = 1754408224 → 2025-08-05 UTC | OK |
| recommended | — (absent) | should be `true` | console.groq.com/docs/models features it as "OpenAI's flagship open-weight language model" (~500 t/s); deprecations page names `openai/gpt-oss-120b` as the recommended replacement (incl. for kimi-k2-instruct-0905) | **FIX: add `recommended: true`** |
| deprecated | — | active | live API `active: true`; not on deprecations page | OK |

### groq/openai/gpt-oss-20b

| Field | Repo value | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing.input | 0.075 | $0.075/M | groq.com/pricing; OpenRouter | OK |
| pricing.cachedInput | 0.0375 | $0.0375/M | groq.com/pricing (explicit); OpenRouter 0.0000000375 | OK (PR #4990 confirmed) |
| pricing.output | 0.3 | $0.30/M | groq.com/pricing; OpenRouter | OK |
| contextWindow | 131072 | 131072 | Groq API; model card "up to 131K" | OK |
| capabilities.maxOutputTokens | — | 65536 | Groq API `max_completion_tokens`; OpenRouter agrees | **FIX: add 65536** |
| releaseDate | 2025-08-05 | 2025-08-05 | Groq API `created` = 1754407957 → 2025-08-05 UTC | OK |
| deprecated | — | active | live API; deprecations page | OK |

### groq/openai/gpt-oss-safeguard-20b

| Field | Repo value | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing.input | 0.075 | $0.075/M | groq.com/pricing | OK |
| pricing.cachedInput | 0.0375 | $0.0375/M | prompt-caching doc lists this model as caching-supported with "50% discount for cached input tokens" → 0.075 × 0.5 = 0.0375. Pricing page shows no cached column for this row; OpenRouter shows $0.037/M (rounding). Groq's caching doc wins. | OK (PR #4990 confirmed) |
| pricing.output | 0.3 | $0.30/M | groq.com/pricing | OK |
| contextWindow | 131072 | 131072 | Groq API | OK |
| capabilities.maxOutputTokens | — | 65536 | Groq API `max_completion_tokens`; OpenRouter agrees | **FIX: add 65536** |
| releaseDate | 2025-10-29 | 2025-10-29 | Groq API `created` = 1761708789 → 2025-10-29 UTC | OK |
| deprecated | — | active | live API; deprecations page | OK |

### groq/qwen/qwen3-32b

| Field | Repo value | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing.input | 0.29 | $0.29/M | groq.com/pricing; OpenRouter | OK |
| pricing.cachedInput | — | none on Groq | Not in prompt-caching supported list (gpt-oss ×3 only); no cached column on pricing page. OpenRouter shows a 50% `input_cache_read` ($0.145) — Groq docs win; do not add. | OK (absent) |
| pricing.output | 0.59 | $0.59/M | groq.com/pricing; OpenRouter | OK |
| contextWindow | 131072 | 131072 | Groq API | OK |
| capabilities.maxOutputTokens | — | 40960 | Groq API `max_completion_tokens`; OpenRouter agrees | **FIX: add 40960** |
| releaseDate | 2025-04-29 | 2025-04-29 | Upstream Qwen3 family launch (field is "first publicly released"). Groq endpoint `created` is 2025-05-28 (when Groq added it) — repo convention uses upstream release. | OK |
| deprecated | — | **not deprecated** | `active: true` in live API; absent from deprecations page (appears there only as a *replacement* for mistral-saba-24b / qwen-qwq-32b) | OK — confirmed still active (open question f) |

### groq/llama-3.1-8b-instant

| Field | Repo value | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing.input | 0.05 | $0.05/M | groq.com/pricing; OpenRouter | OK |
| pricing.output | 0.08 | $0.08/M | groq.com/pricing; OpenRouter | OK |
| pricing.cachedInput | — | none on Groq | Not in caching-supported list; no cached column on pricing page (OpenRouter's $0.025 row not honored — Groq wins) | OK (absent) |
| contextWindow | 131072 | 131072 | Groq API | OK |
| capabilities.maxOutputTokens | — | 131072 | Groq API `max_completion_tokens` = 131072 (full window); OpenRouter agrees | **FIX: add 131072** |
| releaseDate | 2024-07-23 | 2024-07-23 | Meta released Llama 3.1 (8B/70B/405B) on 2024-07-23 (ai.meta.com/blog/meta-llama-3-1, press coverage dated 2024-07-23). Groq API `created` (2023-09-03) is a placeholder shared with whisper entries and predates Llama 3.1 — not meaningful. | OK — verified (open question g) |
| speedOptimized | — (absent) | should be `true` | Groq's speed-tier "-instant" naming; model card positions it for "Real-Time Applications … requiring instant responses and high throughput"; cheapest text model in the lineup. Matches repo precedent (claude-3-haiku, gemini-2.0-flash). | **FIX: add `speedOptimized: true`** |
| deprecated | — | active | live API; deprecations page (it is a replacement target, not deprecated) | OK |

### groq/llama-3.3-70b-versatile

| Field | Repo value | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing.input | 0.59 | $0.59/M | groq.com/pricing; OpenRouter | OK |
| pricing.output | 0.79 | $0.79/M | groq.com/pricing; OpenRouter | OK |
| contextWindow | 131072 | 131072 | Groq API | OK |
| capabilities.maxOutputTokens | — | 32768 | Groq API `max_completion_tokens`; OpenRouter agrees | **FIX: add 32768** |
| releaseDate | 2024-12-06 | 2024-12-06 | Groq API `created` = 1733447754 → 2024-12-06 UTC, matching Meta's Llama 3.3 launch day | OK — verified (open question g) |
| deprecated | — | active | live API; deprecations page (replacement target for several retired models) | OK |

### groq/meta-llama/llama-4-scout-17b-16e-instruct

| Field | Repo value | Verified value | Source | Verdict |
|---|---|---|---|---|
| pricing.input | 0.11 | $0.11/M | groq.com/pricing; OpenRouter | OK |
| pricing.output | 0.34 | $0.34/M | groq.com/pricing; OpenRouter | OK |
| contextWindow | 131072 | 131072 | Groq API | OK |
| capabilities.maxOutputTokens | — | 8192 | Groq API `max_completion_tokens`; OpenRouter agrees | **FIX: add 8192** |
| releaseDate | 2025-04-05 | 2025-04-05 | Groq API `created` = 1743874824 → 2025-04-05 UTC (Meta Llama 4 launch day) | OK |
| deprecated | — | active | live API; deprecations page | OK |

### groq/moonshotai/kimi-k2-instruct-0905

| Field | Repo value | Verified value | Source | Verdict |
|---|---|---|---|---|
| deprecated | true | shut down | console.groq.com/docs/deprecations: shutdown **04/15/26**, replacement `openai/gpt-oss-120b`; model entirely absent from the live `/v1/models` response | OK (PR #4990 change confirmed — open question regarding shutdown resolved) |
| pricing.input | 1.0 | $1.00/M | groq.com/pricing (row still present); OpenRouter | OK |
| pricing.output | 3.0 | $3.00/M | groq.com/pricing; OpenRouter | OK |
| pricing.cachedInput | — | conflicting | groq.com/pricing still shows $0.50 cached, but the prompt-caching doc's supported list contains only the 3 gpt-oss models, and the model is removed from the API. Conflicting Groq sources + shut-down model → not added (see "Deliberately not changed"). | OK (absent) |
| contextWindow | 262144 | 262144 | Moonshot K2-0905 announcement ("context length expanded from 128K to 256K"); Groq model card description "256K context"; OpenRouter Groq row 262144. Live Groq API no longer lists the model. | OK |
| capabilities.maxOutputTokens | — | 16384 (OpenRouter only) | Only source is OpenRouter; model is gone from Groq's API and its doc-page spec table cannot be rendered. Cannot confirm from Groq's own docs → **skipped** per validation rules. | Not added (unverifiable from Groq) |
| releaseDate | 2025-09-05 | 2025-09-05 | Moonshot AI announced K2-Instruct-0905 on September 5, 2025 (aibase coverage; simonwillison.net 2025-09-06; the `0905` suffix) | OK — verified (open question g) |
| pricing.updatedAt | 2026-04-01 | — | Prices re-checked today and unchanged; model is shut down, so no bump needed | OK |

## Provider-Level Capability: temperature

**Recommendation: add `temperature: { min: 0, max: 2 }` to the groq provider `capabilities`.**

- Groq's OpenAPI spec (embedded in console.groq.com docs pages, chat-completions `temperature`): "What sampling temperature to use, between 0 and 2", `"minimum": 0, "maximum": 2`.
- `apps/sim/providers/groq/index.ts:82` already forwards it: `if (request.temperature !== undefined) payload.temperature = request.temperature` — so the only thing missing is the capability flag; today Sim hides the temperature slider for every Groq model while the provider would happily accept the value.
- Precedent: `fireworks` (models.ts:97), `together` (models.ts:113), and `baseten` (models.ts:129) all declare `temperature: { min: 0, max: 2 }` at the provider level for the same OpenAI-compatible 0–2 range.

**Test impact** (`apps/sim/providers/utils.test.ts`):
- ~line 214: `'groq/meta-llama/llama-4-scout-17b-16e-instruct'` must be removed from the `unsupportedModels` list in the `supportsTemperature` → false test (it will now return `true`; move it to the supported list).
- ~line 288: `expect(getMaxTemperature('groq/meta-llama/llama-4-scout-17b-16e-instruct')).toBeUndefined()` must change to expect `2` (move into the "range 0-2" group).

## Changes made in this pass

None to `models.ts` (per instructions — doc only). The fix list below is the recommended diff.

1. `groq` provider capabilities: add `temperature: { min: 0, max: 2 }` (+ update the two utils.test.ts assertions above).
2. `groq/openai/gpt-oss-120b`: `capabilities: {}` → `capabilities: { maxOutputTokens: 65536 }`; add `recommended: true`.
3. `groq/openai/gpt-oss-20b`: add `maxOutputTokens: 65536`.
4. `groq/openai/gpt-oss-safeguard-20b`: add `maxOutputTokens: 65536`.
5. `groq/qwen/qwen3-32b`: add `maxOutputTokens: 40960`.
6. `groq/llama-3.1-8b-instant`: add `maxOutputTokens: 131072`; add `speedOptimized: true`.
7. `groq/llama-3.3-70b-versatile`: add `maxOutputTokens: 32768`.
8. `groq/meta-llama/llama-4-scout-17b-16e-instruct`: add `maxOutputTokens: 8192`.

## Deliberately not changed

- **kimi-k2-instruct-0905 `cachedInput`**: groq.com/pricing still shows $0.50 cached, but the canonical prompt-caching doc's supported-model list is exactly the three gpt-oss models, and the model is shut down (absent from the live API since the 2026-04-15 shutdown). Conflicting Groq sources for a decommissioned model — adding a cached rate would be dead config. Reconciliation: the pricing-page row is residual for a removed model; the caching doc never listed kimi.
- **kimi-k2-instruct-0905 `maxOutputTokens`**: 16384 is OpenRouter-only; cannot be confirmed from Groq's own docs/API (model removed). Skipped per validation rules.
- **`cachedInput` on qwen3-32b / llama-3.1-8b-instant**: OpenRouter's Groq endpoints advertise 50% `input_cache_read` rates, but Groq's prompt-caching doc explicitly limits caching support to the three gpt-oss models and the pricing page shows no cached column for them. Groq docs win. Re-check if Groq's promised caching rollout ("more models soon") lands.
- **All pricing, contextWindow, releaseDate values**: verified correct as-is (including all PR #4990 changes — kimi `deprecated: true`, the three gpt-oss `cachedInput` rates, and `updatedAt: '2026-06-11'` bumps).
- **kimi `pricing.updatedAt: '2026-04-01'`**: prices unchanged and model shut down; no bump needed.
- **`defaultModel: 'groq/llama-3.3-70b-versatile'`**: still active and reasonable; changing the default is a product decision, not a validation finding.

## Unverifiable

- **kimi-k2-instruct-0905 `maxOutputTokens` (16384)** — Groq removed the model from its API and the doc page's spec table no longer renders; only OpenRouter attests it.
- Nothing else: every other field was confirmed against at least one Groq-owned source (live `/v1/models` API, groq.com/pricing, prompt-caching doc, deprecations doc, or embedded OpenAPI spec), with OpenRouter as a corroborating secondary on pricing and token limits.
