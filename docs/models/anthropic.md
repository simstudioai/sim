# Anthropic Provider Model Validation — Justification Doc

- **Date:** 2026-06-11
- **Scope:** `anthropic` provider block in `apps/sim/providers/models.ts` (12 models), re-verified after PR #4990
- **Method:** Live WebFetch of official Anthropic docs (platform.claude.com), secondary pricing source (OpenRouter), Anthropic news posts via web search for launch dates, plus `rg` verification that every capability flag is actually consumed by provider code (`apps/sim/providers/anthropic/core.ts`, `apps/sim/providers/models.ts`, `apps/sim/providers/utils.ts`).
- **Primary sources:**
  - Models overview: https://platform.claude.com/docs/en/about-claude/models/overview
  - Pricing: https://platform.claude.com/docs/en/about-claude/pricing
  - Deprecations: https://platform.claude.com/docs/en/about-claude/model-deprecations
  - Effort: https://platform.claude.com/docs/en/build-with-claude/effort
  - Structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
  - Computer use: https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
  - Messages API: https://platform.claude.com/docs/en/api/messages
  - Secondary pricing: https://openrouter.ai/provider/anthropic
  - Launch dates: https://www.anthropic.com/news/claude-4 , https://www.anthropic.com/news/claude-3-haiku

**Verdict key:** ✓ = verified against live docs · ⚠ = recommended change · ◆ = intentional deviation (documented) · ◇ = unverifiable from live docs (reason given)

---

## How capability fields are consumed (code verification)

| Field | Consumer | Behavior |
|---|---|---|
| `thinking.levels` / `thinking.default` | `core.ts` `buildThinkingConfig()` via `getThinkingCapability()` | Level must be in `levels` or thinking is skipped. Fable 5 / Opus 4.8 / 4.7 / 4.6 / Sonnet 4.6 (`supportsAdaptiveThinking()`) → `thinking: {type: 'adaptive'}` + `output_config: {effort: <level>}`. All other models → `thinking: {type: 'enabled', budget_tokens}` with low=2048 / medium=8192 / high=32768 (so `xhigh`/`max` must never appear on a budget-tokens model — `THINKING_BUDGET_TOKENS` has no entry and config would be dropped). |
| `temperature` | payload construction in `core.ts` | Presence of `capabilities.temperature` allows the param; omitted on a model means Sim never sends it. Stripped when thinking enabled (thinking incompatible with temperature). |
| `nativeStructuredOutputs` | `models.ts:3393` (`getModelsWithNativeStructuredOutputs`-style helper) consumed by `core.ts` | With flag → native `output_format`/`output_config` JSON-schema path; without → `generateSchemaInstructions()` prompt-injection fallback. |
| `computerUse` | `models.ts:3167` `getComputerUseModels()` → `providers/utils.ts:143` `computerUseModels` | Gates Sim's computer-use path per provider. **No Anthropic model currently sets it.** |
| `contextWindow` / `maxOutputTokens` / `pricing` | cost calculation, token clamping, UI | Straight passthrough. Sim does **not** send any `context-1m-*` beta header (`rg 'context-1m' apps/sim/providers/anthropic/` → no matches), so `contextWindow` must reflect the no-beta-header window. |
| `reasoningEffort` / `verbosity` | **not consumed** by the Anthropic provider (OpenAI-family fields) | Correctly absent from all Anthropic entries. |

---

## Per-model field verification

### claude-fable-5

| Field | Value | Source | Verdict |
|---|---|---|---|
| pricing.input | 10.0 | Pricing doc ($10/MTok); OpenRouter $10/M | ✓ |
| pricing.cachedInput | 1.0 | Pricing doc cache hit $1/MTok (0.1×) | ✓ |
| pricing.output | 50.0 | Pricing doc $50/MTok; OpenRouter $50/M | ✓ |
| capabilities.temperature | absent | Deprecations doc: sampling params 400 on Opus 4.7 and later; Fable 5 rejects `temperature`/`top_p`/`top_k` | ✓ |
| capabilities.nativeStructuredOutputs | **absent** | Structured-outputs doc: "generally available … for **Claude Fable 5**, Claude Mythos 5, Claude Opus 4.8, …" | ⚠ **should be `true`** — Fable 5 is in the GA list; current absence routes Fable 5 through the prompt-injection fallback instead of native JSON-schema output |
| capabilities.maxOutputTokens | 128000 | Models overview: Max output 128k | ✓ |
| thinking.levels | low–xhigh–max | Effort doc: `max` available on Fable 5; `xhigh` available on Fable 5; low/medium/high universal | ✓ |
| thinking.default | high | Effort doc: default is `high` | ✓ |
| contextWindow | 1000000 | Models overview: 1M tokens (default, no beta header) | ✓ |
| releaseDate | 2026-06-09 | Models overview: "generally available … beginning June 9, 2026" | ✓ |
| (no deprecated flag) | — | Active | ✓ |

Note: Fable 5's thinking is always-on; Sim's adaptive path (`thinking: {type:'adaptive'}` + effort) is the documented-correct call shape. The `'none'` sentinel omits the `thinking` param, which on Fable 5 means adaptive-by-default rather than disabled — acceptable (explicit `disabled` would 400).

### claude-opus-4-8

| Field | Value | Source | Verdict |
|---|---|---|---|
| pricing.input / cachedInput / output | 5.0 / 0.5 / 25.0 | Pricing doc $5 / $0.50 cache-hit / $25; OpenRouter $5/$25 | ✓ |
| pricing.updatedAt | 2026-05-28 | bumped in PR #4990 | ✓ |
| temperature | absent | Deprecations doc: 400 on Opus 4.7 and later, "including Claude Opus 4.8" | ✓ |
| nativeStructuredOutputs | true | Structured-outputs doc GA list | ✓ |
| maxOutputTokens | 128000 | Models overview | ✓ |
| thinking.levels | low–xhigh–max | Effort doc: `xhigh` and `max` available on Opus 4.8 | ✓ |
| thinking.default | high | Effort doc: "The default is `high` on all surfaces" | ✓ |
| contextWindow | 1000000 | Models overview: 1M (standard pricing, no long-context premium) | ✓ |
| releaseDate | 2026-05-28 | Deprecations doc: tentative retirement "Not sooner than May 28, **2027**" (release + 1 yr convention) — confirms the PR #4990 correction | ✓ changed this pass (PR #4990), re-verified |
| recommended | true | Sim product choice; consistent with docs' "most capable Opus-tier model" | ◆ product decision |

### claude-opus-4-7

| Field | Value | Source | Verdict |
|---|---|---|---|
| pricing | 5.0 / 0.5 / 25.0 (updatedAt 2026-04-16) | Pricing doc; OpenRouter $5/$25 | ✓ |
| temperature | absent | Deprecations doc: 400 on Opus 4.7+ | ✓ |
| nativeStructuredOutputs | true | Structured-outputs doc GA list | ✓ |
| maxOutputTokens | 128000 | Models overview (legacy table) | ✓ |
| thinking.levels | low–xhigh–max | Effort doc: `xhigh` introduced with 4.7; `max` available | ✓ |
| contextWindow | 1000000 | Models overview legacy table: 1M | ✓ |
| releaseDate | 2026-04-16 | Deprecations doc: "Not sooner than April 16, 2027" | ✓ |

### claude-opus-4-6

| Field | Value | Source | Verdict |
|---|---|---|---|
| pricing | 5.0 / 0.5 / 25.0 (updatedAt 2026-06-11) | Pricing doc; OpenRouter $5/$25 | ✓ |
| temperature {0,1} | present | Sampling-param removal is "Opus 4.7 and later" — Opus 4.6 still accepts `temperature` (0.0–1.0 per Messages API) | ✓ |
| nativeStructuredOutputs | true | Structured-outputs doc GA list | ✓ |
| maxOutputTokens | 128000 | Models overview legacy table | ✓ |
| thinking.levels | low/medium/high/**max** (no xhigh) | Effort doc: `max` on Opus 4.6 ✓; `xhigh` only on Fable 5 / Opus 4.8 / 4.7 — correctly excluded | ✓ |
| contextWindow | 1000000 | Models overview legacy table: 1M | ✓ |
| releaseDate | 2026-02-05 | Deprecations doc: "Not sooner than February 5, 2027" | ✓ |

### claude-sonnet-4-6

| Field | Value | Source | Verdict |
|---|---|---|---|
| pricing | 3.0 / 0.3 / 15.0 (updatedAt 2026-06-11) | Pricing doc $3 / $0.30 / $15; OpenRouter $3/$15 | ✓ |
| temperature {0,1} | present | Sonnet 4.6 is not in the "Opus 4.7 and later" sampling-param removal; temperature 0.0–1.0 valid | ✓ |
| nativeStructuredOutputs | true | Structured-outputs doc GA list | ✓ |
| maxOutputTokens | 64000 | Models overview: 64k | ✓ |
| thinking.levels | low/medium/high/**max** (no xhigh) | Effort doc: `max` available on Sonnet 4.6; `xhigh` is NOT (Fable 5 / Opus 4.8 / 4.7 only) | ✓ |
| contextWindow | 1000000 | Models overview: 1M, no beta header required; "Long context pricing": full 1M at standard pricing on Sonnet 4.6 | ✓ |
| releaseDate | 2026-02-17 | Deprecations doc: "Not sooner than February 17, 2027" | ✓ |
| recommended | true | Sim product choice ("best combination of speed and intelligence") | ◆ product decision |

### claude-opus-4-5

| Field | Value | Source | Verdict |
|---|---|---|---|
| pricing | 5.0 / 0.5 / 25.0 (updatedAt 2026-06-11) | Pricing doc; OpenRouter $5/$25 | ✓ |
| temperature {0,1} | present | ≤ 4.6-era model; accepted | ✓ |
| nativeStructuredOutputs | true | Structured-outputs doc GA list ("Claude Opus 4.5") | ✓ |
| maxOutputTokens | 64000 | Models overview legacy table | ✓ |
| thinking.levels | low/medium/high | Effort doc: Opus 4.5 supports effort but neither `max` nor `xhigh`. Sim's code path for 4.5 uses `budget_tokens` (not effort) — levels map to budget tiers; same three levels are valid either way | ✓ |
| contextWindow | 200000 | Models overview legacy table: 200k | ✓ |
| releaseDate | 2025-11-24 | Deprecations doc: "Not sooner than November 24, 2026"; anthropic.com/news/claude-opus-4-5 (Nov 24, 2025) | ✓ |

### claude-opus-4-1

| Field | Value | Source | Verdict |
|---|---|---|---|
| pricing | 15.0 / 1.5 / 75.0 (updatedAt 2026-06-11) | Pricing doc $15 / $1.50 / $75; OpenRouter $15/$75 | ✓ |
| temperature {0,1} | present | pre-4.7 model; accepted | ✓ |
| nativeStructuredOutputs | **removed in PR #4990** | Structured-outputs doc GA list does **not** include Opus 4.1 | ✓ changed this pass (PR #4990), re-verified correct |
| maxOutputTokens | 32000 | Models overview legacy table: 32k | ✓ |
| thinking.levels | low/medium/high | budget_tokens model; extended thinking supported | ✓ |
| contextWindow | 200000 | Models overview legacy table | ✓ |
| releaseDate | 2025-08-05 | Snapshot `claude-opus-4-1-20250805`; launched Aug 5, 2025 | ✓ |
| deprecated | true | Deprecations doc: deprecated June 5, 2026; retires Aug 5, 2026 → migrate to claude-opus-4-8 | ✓ changed this pass (PR #4990), re-verified |

### claude-opus-4-0

| Field | Value | Source | Verdict |
|---|---|---|---|
| pricing | 15.0 / 1.5 / 75.0 (updatedAt 2026-06-11) | Pricing doc ("Claude Opus 4 (deprecated)"); OpenRouter $15/$75 | ✓ |
| temperature {0,1} | present | pre-4.7; accepted | ✓ |
| nativeStructuredOutputs | absent | Not in structured-outputs GA list | ✓ |
| maxOutputTokens | 32000 | Models overview legacy table | ✓ |
| thinking.levels | low/medium/high | budget_tokens model | ✓ |
| contextWindow | 200000 | Models overview legacy table | ✓ |
| releaseDate | 2025-05-22 | **Open question (a) resolved:** Claude 4 (Opus 4 + Sonnet 4) launched **May 22, 2025** (anthropic.com/news/claude-4). The `20250514` in the full ID is the snapshot date, not the launch date. Repo convention uses launch dates (cf. haiku-4-5: launch 2025-10-15 vs snapshot 20251001) | ✓ — **no change recommended** |
| deprecated | true | Deprecations doc: deprecated Apr 14, 2026; retires June 15, 2026 → claude-opus-4-8 | ✓ changed this pass (PR #4990), re-verified |

### claude-sonnet-4-5

| Field | Value | Source | Verdict |
|---|---|---|---|
| pricing | 3.0 / 0.3 / 15.0 (updatedAt 2026-06-11) | Pricing doc; OpenRouter $3/$15 | ✓ |
| temperature {0,1} | present | pre-4.7; accepted | ✓ |
| nativeStructuredOutputs | true | Structured-outputs doc GA list ("Claude Sonnet 4.5") | ✓ |
| maxOutputTokens | 64000 | Models overview legacy table | ✓ |
| thinking.levels | low/medium/high | Effort doc: effort errors on Sonnet 4.5 — Sim correctly routes it through budget_tokens; no max/xhigh | ✓ |
| contextWindow | 200000 | **Open question (e) resolved:** Models overview legacy table lists Sonnet 4.5 at **200k**. The historical 1M for Sonnet 4.5 required the `context-1m` beta header, which Sim does not send (`rg 'context-1m'` → no matches in `apps/sim/providers/anthropic/`) | ✓ changed this pass (PR #4990, 1000000 → 200000), re-verified correct |
| releaseDate | 2025-09-29 | Snapshot `claude-sonnet-4-5-20250929`; launched Sep 29, 2025 | ✓ |

### claude-sonnet-4-0

| Field | Value | Source | Verdict |
|---|---|---|---|
| pricing | 3.0 / 0.3 / 15.0 (updatedAt 2026-06-11) | Pricing doc ("Claude Sonnet 4 (deprecated)"); OpenRouter $3/$15 | ✓ |
| temperature {0,1} | present | pre-4.7; accepted | ✓ |
| nativeStructuredOutputs | absent | Not in structured-outputs GA list | ✓ |
| maxOutputTokens | 64000 | Models overview legacy table: 64k | ✓ |
| thinking.levels | low/medium/high | budget_tokens model | ✓ |
| contextWindow | 200000 | Models overview legacy table: 200k; same `context-1m` beta-header reasoning as Sonnet 4.5 | ✓ changed this pass (PR #4990), re-verified correct |
| releaseDate | 2025-05-22 | Claude 4 launch May 22, 2025 (see opus-4-0) — no change | ✓ |
| deprecated | true | Deprecations doc: deprecated Apr 14, 2026; retires June 15, 2026 → claude-sonnet-4-6 | ✓ changed this pass (PR #4990), re-verified |

### claude-haiku-4-5

| Field | Value | Source | Verdict |
|---|---|---|---|
| pricing | 1.0 / 0.1 / 5.0 (updatedAt 2026-06-11) | Pricing doc $1 / $0.10 / $5; OpenRouter $1/$5 | ✓ |
| temperature {0,1} | present | pre-4.7; accepted | ✓ |
| nativeStructuredOutputs | true | Structured-outputs doc GA list | ✓ |
| maxOutputTokens | 64000 | Models overview: 64k | ✓ |
| thinking.levels | low/medium/high | Effort doc: effort errors on Haiku 4.5; extended thinking (budget_tokens) supported — Sim routes via budget_tokens | ✓ |
| contextWindow | 200000 | Models overview: 200k | ✓ |
| releaseDate | 2025-10-15 | Launch Oct 15, 2025 (deprecations doc: retirement "Not sooner than October 15, 2026"); snapshot is `20251001` — repo correctly uses the launch date | ✓ |
| speedOptimized | true | Sim-internal flag; docs: "The fastest model" | ◆ Sim-internal, consistent |

### claude-3-haiku-20240307

| Field | Value | Source | Verdict |
|---|---|---|---|
| pricing.input / output | 0.25 / 1.25 (updatedAt 2026-04-01) | ◇ No longer listed on the live pricing page (only retired Haiku 3.5 remains) or OpenRouter — model is retired. Values match Anthropic's historical published pricing ($0.25/$1.25) | ◇ unverifiable live; historically consistent — leave as-is |
| pricing.cachedInput | 0.03 | ◇ Historical cache-hit pricing for Claude 3 Haiku was $0.03/MTok (slightly above the 0.1× convention) | ◇ unverifiable live; historically consistent |
| temperature {0,1} | present | Claude 3-era; accepted (model no longer serves requests anyway) | ✓ (moot) |
| maxOutputTokens | 4096 | Historical Claude 3 Haiku max output | ◇ unverifiable live; historically consistent |
| no thinking capability | absent | Claude 3 Haiku has no extended thinking | ✓ |
| contextWindow | 200000 | Historical Claude 3 family window | ◇ unverifiable live; historically consistent |
| releaseDate | 2024-03-07 | Claude 3 Haiku GA was **March 13, 2024** (anthropic.com/news/claude-3-haiku); `20240307` is the snapshot date. Repo convention elsewhere uses launch dates | ⚠ optional: `2024-03-07` → `2024-03-13` (cosmetic; model is retired) |
| deprecated | true | Deprecations doc: **Retired April 20, 2026** ("Requests to retired models will fail") | ◆ see open question (b) below |

---

## Changes made in this pass (PR #4990) — all re-verified correct

| Change | Verification |
|---|---|
| opus-4-8 releaseDate → 2026-05-28 | Deprecations doc retirement floor "May 28, 2027" (release + 1 yr) ✓ |
| deprecated:true on opus-4-1 | Deprecated 2026-06-05, retires 2026-08-05 ✓ |
| deprecated:true on opus-4-0, sonnet-4-0 | Deprecated 2026-04-14, retire 2026-06-15 ✓ |
| sonnet-4-5 & sonnet-4-0 contextWindow 1000000 → 200000 | Models overview legacy table: both 200k. The 1M window on these models was beta-header-gated (`context-1m`); Sim never sends that header ✓ |
| removed nativeStructuredOutputs from opus-4-1 | Opus 4.1 absent from structured-outputs GA list ✓ |
| updatedAt bumps | informational ✓ |

## Recommended fixes from THIS validation

1. **claude-fable-5: add `nativeStructuredOutputs: true`.** Structured-outputs doc explicitly lists Claude Fable 5 as GA. Without the flag, Sim falls back to prompt-injected schema instructions for Fable 5 instead of the native JSON-schema output path — weaker guarantees on the flagship model.
2. *(optional, cosmetic)* **claude-3-haiku-20240307: releaseDate `2024-03-07` → `2024-03-13`.** Repo convention is launch date (not snapshot date); GA was March 13, 2024. Low value since the model is retired.

## Deliberately not changed

- **`computerUse` on Anthropic models (open question c).** Anthropic documents computer-use support (beta) for: Opus 4.8 / 4.7 / 4.6 / 4.5 + Sonnet 4.6 (header `computer-use-2025-11-24`) and Sonnet 4.5, Haiku 4.5, Opus 4.1, Sonnet 4, Opus 4 (header `computer-use-2025-01-24`). **Claude Fable 5 is NOT in the documented list.** The flag IS consumed (`getComputerUseModels()` → `providers/utils.ts` `computerUseModels`), so setting it would light up Sim's computer-use path for these models — a feature-enablement/product decision (beta headers, screenshot plumbing, UX), not a data correction. Left unchanged; documented here for whoever owns that decision.
- **opus-4-0 / sonnet-4-0 releaseDate `2025-05-22` (open question a).** Confirmed correct: Claude 4 launched May 22, 2025; `20250514` is the snapshot suffix, not the launch date.
- **claude-3-haiku-20240307 entry kept (open question b).** The model was retired 2026-04-20 — live requests now fail. Recommendation: **keep the entry with `deprecated: true`** rather than delete. Removing it would break saved workflows that reference the model ID (model lookup, pricing for historical logs, UI rendering of old runs). The schema has no `retired` field; if one is ever added, this model is the first candidate. Runtime failures surface from Anthropic's API as clear 404s, which is an acceptable failure mode for a retired model.
- **`recommended` flags (opus-4-8, sonnet-4-6) and `speedOptimized` (haiku-4-5)** — Sim product/UI decisions, consistent with docs positioning; not doc-verifiable facts.
- **`defaultModel: 'claude-sonnet-4-6'`** — active, recommended model; valid product choice.
- **Thinking level lists for budget-tokens models (opus-4-5, sonnet-4-5, sonnet-4-0, opus-4-1, opus-4-0, haiku-4-5).** Their `low/medium/high` are Sim-defined budget tiers (2048/8192/32768 budget_tokens), not API effort levels — internally consistent with `THINKING_BUDGET_TOKENS` in `core.ts`. Note Opus 4.5 does support the API `effort` param (low/medium/high) per the effort doc, but Sim routes it through budget_tokens (`supportsAdaptiveThinking()` excludes 4.5); that is a code-path choice in `core.ts`, not a models.ts data error, and the level list is valid under either interpretation.

## Open question (d) resolution — thinking levels & temperature boundary

- `xhigh`: Fable 5, Opus 4.8, Opus 4.7 only (effort doc). Repo ✓.
- `max`: Fable 5, Opus 4.8, Opus 4.7, Opus 4.6, Sonnet 4.6 (effort doc; **not** Opus 4.5 / Sonnet 4.5 / Haiku 4.5). Repo ✓ — including Sonnet 4.6 `max`, verified.
- Effort default `high` on all supporting models (effort doc: "Setting effort to high produces exactly the same behavior as omitting the parameter"). Repo `default: 'high'` ✓.
- Temperature boundary: deprecations doc — `temperature`/`top_p`/`top_k` return 400 on **Opus 4.7 and later (incl. Opus 4.8) and Fable 5**; still valid (0.0–1.0, default 1.0 per Messages API) on Opus 4.6, Sonnet 4.6, and everything earlier. Repo: temperature absent exactly on fable-5 / opus-4-8 / opus-4-7, present `{min:0, max:1}` on opus-4-6 / sonnet-4-6 and all older models ✓.

## Unverifiable

- **claude-3-haiku-20240307 pricing, contextWindow (200k), maxOutputTokens (4096):** the model is retired and has been removed from the live pricing/overview pages and OpenRouter. Values match Anthropic's historical published specs; no contradiction found. No change recommended.
- **Exact cache-write pricing is not modeled** (Sim's schema has only `cachedInput` = cache read). Live docs confirm cache reads = 0.1× input for every current model, matching all `cachedInput` values. 5-min/1-hour write premiums (1.25× / 2×) are not representable in the current schema — noting for completeness, not a defect.
