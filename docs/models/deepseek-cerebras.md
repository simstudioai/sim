# Model Validation: `deepseek` & `cerebras` — apps/sim/providers/models.ts

- **Date:** 2026-06-11
- **Scope:** Final exhaustive re-validation after PR #4990 (deepseek-chat/reasoner repricing + 1M ctx, deprecation flags on deepseek-v3/r1 and cerebras llama3.1-8b/qwen-3-235b)
- **Method:** Live WebFetch of provider docs (primary), OpenRouter/ArtificialAnalysis/aggregators (secondary), DeepSeek news archive for release dates, `rg` of provider code to confirm capability consumption. Provider docs win on conflicts.

## Sources

| Source | URL |
|---|---|
| DeepSeek pricing (primary) | https://api-docs.deepseek.com/quick_start/pricing |
| DeepSeek list-models (primary) | https://api-docs.deepseek.com/api/list-models |
| DeepSeek chat-completion API ref (primary) | https://api-docs.deepseek.com/api/create-chat-completion |
| DeepSeek reasoning guide (primary) | https://api-docs.deepseek.com/guides/reasoning_model |
| DeepSeek V3 announcement | https://api-docs.deepseek.com/news/news1226 |
| DeepSeek R1 announcement | https://api-docs.deepseek.com/news/news250120 |
| DeepSeek V4 preview announcement | https://api-docs.deepseek.com/news/news260424 |
| Cerebras models overview (primary) | https://inference-docs.cerebras.ai/models/overview |
| Cerebras gpt-oss model page (primary) | https://inference-docs.cerebras.ai/models/openai-oss |
| Cerebras zai-glm-4.7 model page (primary) | https://inference-docs.cerebras.ai/models/zai-glm-47 |
| Cerebras deprecations (primary) | https://inference-docs.cerebras.ai/support/deprecation |
| Cerebras chat-completions API ref (primary) | https://inference-docs.cerebras.ai/api-reference/chat-completions |
| OpenRouter deepseek-v4-flash (secondary) | https://openrouter.ai/deepseek/deepseek-v4-flash |
| OpenRouter GLM 4.7 (secondary) | https://openrouter.ai/z-ai/glm-4.7 |
| ArtificialAnalysis gpt-oss-120b providers (secondary) | https://artificialanalysis.ai/models/gpt-oss-120b/providers |
| aimodelapis Cerebras GLM-4.7 (secondary) | https://aimodelapis.com/providers/cerebras/cerebras-zai-glm-4-7 |
| Cerebras GLM-4.7 launch blog (secondary) | https://www.cerebras.ai/blog/glm-4-7 |

## Code-consumption checks

- `rg "temperature" apps/sim/providers/deepseek/ apps/sim/providers/cerebras/`:
  - `deepseek/index.ts:89` — `if (request.temperature !== undefined) payload.temperature = request.temperature`
  - `cerebras/index.ts:85` — `if (request.temperature !== undefined) payload.temperature = request.temperature`
  - Both providers forward temperature when set; a `temperature` capability in models.ts is what surfaces the slider (`getMaxTempFromDefinitions` in `providers/utils.ts`). With `capabilities: {}` the slider is hidden even though the API accepts the param.
- No `reasoningEffort`, `verbosity`, `thinking`, `nativeStructuredOutputs`, or `computerUse` handling exists in either provider implementation — do **not** add those capabilities even though Cerebras documents `reasoning_effort` (not consumed by code).
- `maxOutputTokens` is a supported capability field (`models.ts:42`) consumed by `providers/index.ts` — safe to recommend.

---

## DeepSeek

### Alias status (Open Question a)

**Confirmed.** DeepSeek pricing page: "The model names `deepseek-chat` and `deepseek-reasoner` will be deprecated on **2026/07/24 15:59 UTC**." They correspond to the **non-thinking** and **thinking** modes of `deepseek-v4-flash` respectively. The list-models API now returns only `deepseek-v4-flash` and `deepseek-v4-pro`. Until 2026-07-24 the aliases remain valid API ids, so keeping them non-deprecated in models.ts is correct **for now** — they must be flipped to `deprecated: true` (or removed) by 2026-07-24.

**Recommendation (separate work, not part of this pass):** add `deepseek-v4-flash` (input $0.14 / cached $0.0028 / output $0.28, ctx 1M, max output 384K, released 2026-04-24) and `deepseek-v4-pro` (input $0.435 / cached $0.003625 / output $0.87, ctx 1M, max output 384K) as first-class entries before the 2026-07-24 alias retirement, then deprecate the aliases.

### deepseek-chat

| Field | Current value | Verified value | Source | Verdict |
|---|---|---|---|---|
| id valid | `deepseek-chat` | Valid alias until 2026-07-24 15:59 UTC (→ v4-flash non-thinking) | pricing page | OK |
| pricing.input | 0.14 | $0.14/M (cache miss) | pricing page | OK |
| pricing.cachedInput | 0.0028 | $0.0028/M (cache hit) | pricing page | OK |
| pricing.output | 0.28 | $0.28/M | pricing page | OK |
| pricing.updatedAt | 2026-06-11 | — | — | OK |
| contextWindow | 1000000 | 1M tokens | pricing page | OK |
| capabilities.temperature | *(absent)* | Supported, range 0–2, default 1 ("What sampling temperature to use, between 0 and 2…") — applies to non-thinking mode | create-chat-completion API ref | **FIX: add `temperature: { min: 0, max: 2 }`** (code at `deepseek/index.ts:89` consumes it) |
| capabilities.maxOutputTokens | *(unset)* | Conflict: pricing page says 384K max output for v4-flash; reasoning guide (thinking mode) says default 32K / max 64K | pricing page vs reasoning guide | Leave unset — see "Deliberately not changed" |
| releaseDate | 2024-12-26 | V3 announcement 2024-12-26 (date the alias pointed to V3); alias now points to v4-flash (released 2026-04-24) | news1226, news260424 | OK (alias semantics — keep original anchor) |
| deprecated | *(absent)* | Alias still live | pricing page | OK until 2026-07-24 |

### deepseek-v3

| Field | Current value | Verified value | Source | Verdict |
|---|---|---|---|---|
| id valid | `deepseek-v3` | **Not** a valid API id (list-models returns only v4-flash/v4-pro; never a documented API id — API ids were deepseek-chat/reasoner) | list-models | OK as `deprecated: true` |
| deprecated | true | Correct | list-models | OK |
| pricing | 0.28 / 0.028 / 0.42 (updatedAt 2026-04-01) | Historical V3.x pricing; model unpurchasable, frozen values acceptable | — | OK (legacy) |
| contextWindow | 128000 | Historical 128K | — | OK (legacy) |
| releaseDate | 2024-12-26 | DeepSeek-V3 announced 2024-12-26 | news1226 | **Verified** |

### deepseek-r1

| Field | Current value | Verified value | Source | Verdict |
|---|---|---|---|---|
| id valid | `deepseek-r1` | **Not** a valid API id (R1 was accessed as `deepseek-reasoner`) | list-models, news250120 | OK as `deprecated: true` |
| deprecated | true | Correct | list-models | OK |
| pricing | 0.55 / 0.14 / 2.19 | Matches original R1 launch pricing ($0.14 hit / $0.55 miss / $2.19 out) | news250120 | **Verified** (legacy, frozen) |
| contextWindow | 128000 | Historical | — | OK (legacy) |
| releaseDate | 2025-01-20 | R1 announced 2025-01-20 | news250120 | **Verified** |

### deepseek-reasoner

| Field | Current value | Verified value | Source | Verdict |
|---|---|---|---|---|
| id valid | `deepseek-reasoner` | Valid alias until 2026-07-24 15:59 UTC (→ v4-flash thinking) | pricing page | OK |
| pricing.input / cachedInput / output | 0.14 / 0.0028 / 0.28 | $0.14 / $0.0028 / $0.28 (same v4-flash pricing, both modes) | pricing page | OK |
| pricing.updatedAt | 2026-06-11 | — | — | OK |
| contextWindow | 1000000 | 1M | pricing page | OK |
| capabilities | `{}` (no temperature) | Reasoning guide: `temperature`, `top_p`, `presence_penalty`, `frequency_penalty`, `logprobs`, `top_logprobs` **not supported** — "will not trigger an error but will also have no effect" | reasoning guide | OK — must NOT add temperature |
| capabilities.maxOutputTokens | *(unset)* | Conflict (384K vs 32K/64K) | see below | Leave unset |
| releaseDate | 2025-01-20 | `model=deepseek-reasoner` introduced with R1 release 2025-01-20 | news250120 ("Use DeepSeek-R1 by setting model=deepseek-reasoner") | **Verified** |

### maxOutputTokens conflict (Open Question a)

- Pricing page (current, v4-flash): **384K max output**.
- Reasoning guide (deepseek-reasoner page): **default 32K, max 64K** — appears not yet updated for V4 (still reflects R1-era limits).
- The aliases map to v4-flash modes, so 384K is *probably* correct, but DeepSeek's own docs disagree with each other and the reasoning guide is the page specific to `deepseek-reasoner`. **Resolution: leave `maxOutputTokens` unset on both aliases** (current state) and set 384000 on the future `deepseek-v4-flash`/`deepseek-v4-pro` entries, where the pricing page is unambiguous.

### Secondary-source pricing (DeepSeek)

OpenRouter lists deepseek-v4-flash at **$0.098 in / $0.196 out** — exactly 70% of official $0.14/$0.28, i.e. the OpenRouter **−30% promo is still present**. Per policy, provider docs win: $0.14 / $0.0028 / $0.28 stands. OpenRouter confirms 1M context and the 2026-04-24 release date.

---

## Cerebras

### Deprecations (confirmed)

Cerebras deprecation page lists **llama3.1-8b** and **qwen-3-235b-a22b-instruct-2507** as deprecated **2026-05-27**, recommended replacement "GPT OSS 120B". Neither appears on the models overview anymore. `deprecated: true` on both entries (PR #4990) is correct.

### cerebras/gpt-oss-120b

| Field | Current value | Verified value | Source | Verdict |
|---|---|---|---|---|
| id valid | `gpt-oss-120b` (after `cerebras/` strip at `cerebras/index.ts:82`) | Production model | models overview, model page | OK |
| pricing.input | 0.35 | $0.35/M | model page (live 2026-06-11) | OK |
| pricing.output | 0.75 | $0.75/M | model page | OK |
| pricing.updatedAt | 2026-06-11 | — | — | OK |
| contextWindow | 131072 | 131k (paid tiers; free tier 65k) | model page | OK (paid tier, consistent with repo convention) |
| capabilities.maxOutputTokens | *(unset)* | 40k paid tiers (32k free) | model page | **FIX: add `maxOutputTokens: 40000`** (paid tier, matching paid-tier ctx) |
| capabilities.temperature | *(absent)* | Cerebras chat-completions API: "sampling temperature to use, between 0 and 2.0" | API reference | **FIX: add `temperature: { min: 0, max: 2 }`** (code at `cerebras/index.ts:85` consumes it) |
| releaseDate | 2025-08-05 | gpt-oss released 2025-08-05; Cerebras day-one launch | cerebras.ai blog "OpenAI GPT OSS 120B Runs Fastest on Cerebras", techintelpro | **Verified** |

Secondary-source note: several aggregators (crackedaiengineering, ArtificialAnalysis blended $0.39) still show launch-era pricing **$0.25/$0.69** and 33K max output. The live Cerebras model page (fetched today) says $0.35/$0.75 and 40k paid-tier max output — provider docs win; aggregators are stale.

### cerebras/llama3.1-8b

| Field | Current value | Verified value | Source | Verdict |
|---|---|---|---|---|
| deprecated | true | Deprecated 2026-05-27, migrate to GPT OSS 120B | deprecation page | **Verified** |
| pricing | 0.10 / 0.10 (frozen 2026-04-01) | Unpurchasable; frozen legacy values | — | OK (legacy) |
| contextWindow | 32768 | Historical | — | OK (legacy) |
| releaseDate | 2024-08-27 | Consistent with Cerebras Inference launch (2024-08-27); not re-verified against a live page this pass | — | Plausible / not re-verified (deprecated model, low stakes) |

### cerebras/qwen-3-235b-a22b-instruct-2507

| Field | Current value | Verified value | Source | Verdict |
|---|---|---|---|---|
| deprecated | true | Deprecated 2026-05-27, migrate to GPT OSS 120B | deprecation page | **Verified** |
| pricing | 0.6 / 1.2 (frozen 2026-04-01) | Unpurchasable; frozen legacy values | — | OK (legacy) |
| contextWindow | 131072 | Historical | — | OK (legacy) |
| releaseDate | 2025-07-29 | Could not verify the exact Cerebras availability date | — | **Unverifiable** (deprecated model; leave as-is) |

### cerebras/zai-glm-4.7

| Field | Current value | Verified value | Source | Verdict |
|---|---|---|---|---|
| id valid | `zai-glm-4.7` | Preview model on overview | models overview, model page | OK |
| pricing.input | 2.25 | $2.25/M | model page; confirmed by aimodelapis (secondary) | OK |
| pricing.output | 2.75 | $2.75/M | model page; aimodelapis | OK |
| pricing.updatedAt | 2026-06-11 | — | — | OK |
| contextWindow | 131072 | 131k paid tiers (free 64k) | model page; aimodelapis (131,000) | OK |
| capabilities.maxOutputTokens | *(unset)* | 40k tokens (both tiers) | model page; aimodelapis (40,000) | **FIX: add `maxOutputTokens: 40000`** |
| capabilities.temperature | *(absent)* | API-wide param, 0–2.0 | API reference | **FIX: add `temperature: { min: 0, max: 2 }`** |
| releaseDate | 2025-12-22 | GLM-4.7 released 2025-12-22 (OpenRouter "Dec 22, 2025"; PR Newswire; Cerebras same-day launch blog) | multiple | **Verified** |

---

## Changes made in this pass (PR #4990) — all re-verified correct

1. `deepseek-chat` & `deepseek-reasoner` repriced to $0.14 / $0.0028 cached / $0.28 — matches v4-flash pricing they now alias. ✅
2. `deepseek-chat` & `deepseek-reasoner` contextWindow → 1,000,000 — matches v4-flash 1M default. ✅
3. `deprecated: true` on `deepseek-v3` and `deepseek-r1` — neither is a valid API id (list-models returns only v4-flash/v4-pro). ✅
4. `deprecated: true` on `cerebras/llama3.1-8b` and `cerebras/qwen-3-235b-a22b-instruct-2507` — Cerebras deprecation page, 2026-05-27. ✅
5. `pricing.updatedAt: 2026-06-11` bumps on the four live-model entries. ✅

## Outstanding fixes recommended (not applied — doc-only pass)

1. `deepseek-chat`: add `capabilities.temperature: { min: 0, max: 2 }` — API ref documents temperature 0–2 (default 1) for chat completions; non-thinking mode honors it; `deepseek/index.ts:89` forwards it. Currently the empty `capabilities` hides Sim's temperature slider for a model that supports it.
2. `cerebras/gpt-oss-120b`: add `capabilities.temperature: { min: 0, max: 2 }` and `capabilities.maxOutputTokens: 40000`.
3. `cerebras/zai-glm-4.7`: add `capabilities.temperature: { min: 0, max: 2 }` and `capabilities.maxOutputTokens: 40000`.

## Deliberately not changed

- **`deepseek-reasoner` capabilities stay `{}`** — reasoning guide explicitly lists temperature as unsupported/no-effect in thinking mode.
- **`deepseek-chat`/`deepseek-reasoner` not marked deprecated** — valid aliases until 2026-07-24 15:59 UTC. Calendar item: deprecate (and add v4-flash/v4-pro entries) before that date.
- **`maxOutputTokens` left unset on both DeepSeek aliases** — DeepSeek docs self-conflict (pricing page: 384K for v4-flash; reasoning guide: 32K default / 64K max for deepseek-reasoner). Set 384000 only on future first-class `deepseek-v4-*` entries where the pricing page is unambiguous.
- **Legacy pricing/ctx on the four deprecated entries** (deepseek-v3, deepseek-r1, llama3.1-8b, qwen-3-235b) — frozen historical values on unpurchasable models; R1 values cross-checked against the original announcement.
- **No `reasoningEffort` capability for Cerebras** despite the model pages documenting `reasoning_effort` — `cerebras/index.ts` does not consume it (capability additions must be backed by docs AND code).
- **OpenRouter −30% DeepSeek promo pricing ($0.098/$0.196) ignored** — provider docs win.
- **deepseek-chat releaseDate kept at 2024-12-26** — anchor is the V3 announcement; the id predates V3 and now aliases v4-flash (2026-04-24); any value is a judgment call for an alias, so the existing anchor is retained.

## Unverifiable

- `cerebras/qwen-3-235b-a22b-instruct-2507` releaseDate 2025-07-29 — no live source found for the exact Cerebras availability date (model delisted). Left as-is.
- `cerebras/llama3.1-8b` releaseDate 2024-08-27 — consistent with the known Cerebras Inference launch date but not re-verified against a live page this pass (model delisted).
- Cerebras temperature **default** value — API ref documents the 0–2.0 range but not a default.
