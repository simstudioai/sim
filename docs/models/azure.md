# Azure OpenAI & Azure Anthropic model validation

**Date:** 2026-06-11
**Scope:** `azure-openai` block (17 models) and `azure-anthropic` block (5 models) in `apps/sim/providers/models.ts`. Final exhaustive re-validation following PR #4990.

## Method

Every field was checked against live primary sources fetched on 2026-06-11:

1. **Specs (context window, max output, version dates, API support, lifecycle):**
   - https://learn.microsoft.com/en-us/azure/ai-foundry/foundry-models/concepts/models-sold-directly-by-azure (doc updated 2026-06-05)
   - https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/reasoning (reasoning effort / verbosity feature matrix, doc updated 2026-06-05)
   - https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/model-retirements (lifecycle policy + gpt-4o dates)
   - https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/model-router and .../concepts/model-router
   - https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-claude (doc updated 2026-06-11)
   - https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry
   - https://platform.claude.com/docs/en/about-claude/pricing
   - https://platform.claude.com/docs/en/about-claude/models/overview
   - https://platform.claude.com/docs/en/build-with-claude/structured-outputs
2. **Azure OpenAI pricing:** Azure Retail Prices API (`https://prices.azure.com/api/retail/prices?$filter=serviceName eq 'Foundry Models' and contains(meterName,'...')`). All quoted prices are the **Global Standard** ("Gl"/"glbl") meters, normalized to USD per 1M tokens. The marketing pricing page times out; the Retail Prices API is authoritative for billed meters.
3. **Provider implementation:** `apps/sim/providers/azure-openai/index.ts` (API dispatch), `apps/sim/providers/azure-anthropic/index.ts` (Messages API via `@anthropic-ai/sdk` against `{endpoint}/anthropic`).

Sim convention notes: `pricing.cachedInput` = cache-read price; `releaseDate` for `azure/*` entries = the Azure model **version date** (convention set in PR #4990 with gpt-4o → 2024-11-20 and model-router → 2025-05-19).

---

## Block: `azure-openai` (defaultModel: `azure/gpt-4o`)

### azure/gpt-4o

| Field | Current value | Source / evidence | Verdict |
| --- | --- | --- | --- |
| pricing.input | 2.5 | Retail API `gpt 4o 1120 Inp glbl` = 0.0025/1K = $2.50/1M | OK |
| pricing.cachedInput | 1.25 | Retail API `gpt 4o 1120 cached Inp glbl` = 0.00125/1K = $1.25/1M | **OK — VERIFIED** (open question b resolved) |
| pricing.output | 10.0 | Retail API `gpt 4o 1120 Outp glbl` = 0.01/1K = $10/1M | OK |
| temperature 0–2 | yes | Standard chat model; reasoning-model parameter restrictions don't apply | OK |
| maxOutputTokens | **(absent)** | models-sold-directly: gpt-4o (2024-11-20) "Input: 128,000 / Output: 16,384" | **FIX: add `maxOutputTokens: 16384`** |
| contextWindow | 128000 | same row | OK |
| releaseDate | 2024-11-20 | Azure version `2024-11-20` (PR #4990 change re-verified) | OK |
| deprecated | (absent) | model-retirements: versions 2024-05-13 / 2024-08-06 **retired 2026-03-31** (auto-upgraded to gpt-5.1); version 2024-11-20 "retires **2026-10-01**" | **RECOMMEND `deprecated: true`** — firm retirement date within ~3.7 months. NOTE: gpt-4o is the `azure-openai` `defaultModel`; changing the default (e.g. to azure/gpt-5.1 per Azure's own auto-upgrade path) is a product decision — documented only, not assumed. |

### azure/gpt-5.4

| Field | Current value | Source / evidence | Verdict |
| --- | --- | --- | --- |
| pricing | 2.5 / 0.25 / 15.0 | Retail API `5.4 inp Gl` 2.5, `5.4 cd inp Gl` 0.25, `5.4 opt Gl` 15.0 | OK |
| reasoningEffort | none, low, medium, high | reasoning doc footnote 7 enumerates `'none'` support as exactly: gpt-5.2, gpt-5.1, gpt-5.1-codex, gpt-5.1-codex-max, gpt-5.1-codex-mini — **gpt-5.4 family is not listed** | **FIX: drop `'none'`** → `['low','medium','high']` (open question c resolved). PR #4990's removal of `'xhigh'` re-verified correct: footnote 6 — xhigh is gpt-5.1-codex-max only. |
| verbosity | low, medium, high | reasoning doc "NEW GPT-5 reasoning features": verbosity options low/medium/high for GPT-5 series | OK |
| maxOutputTokens | 128000 | models-sold-directly: gpt-5.4 (2026-03-05) output 128,000 | OK |
| contextWindow | 1050000 | same row: 1,050,000 (Input 922,000 / Output 128,000) | OK |
| releaseDate | 2026-03-05 | Azure version `2026-03-05` | OK |

Pricing limitation: a long-context tier exists (`5.4 longco inp Gl` $5.0 / `longco cd inp Gl` $0.5 / `longco opt Gl` $22.5) for requests beyond the standard context threshold. The flat pricing schema cannot express tiered pricing; standard-tier rates are recorded.

### azure/gpt-5.4-mini

| Field | Current value | Source / evidence | Verdict |
| --- | --- | --- | --- |
| pricing | 0.75 / 0.075 / 4.5 | Retail API `5.4 mini Inp Gl` 0.75, `cd Inp Gl` 0.075, `Opt Gl` 4.5 | OK |
| reasoningEffort | none, low, medium, high | footnote 7 (see gpt-5.4) | **FIX: drop `'none'`** |
| verbosity | low, medium, high | GPT-5 series verbosity | OK |
| maxOutputTokens / contextWindow | 128000 / 400000 | models-sold-directly: gpt-5.4-mini (2026-03-17) 400,000 (272k in / 128k out) | OK |
| releaseDate | 2026-03-17 | Azure version `2026-03-17` | OK |

### azure/gpt-5.4-nano

| Field | Current value | Source / evidence | Verdict |
| --- | --- | --- | --- |
| pricing | 0.2 / 0.02 / 1.25 | Retail API `5.4 nano Inp Gl` 0.2, `cd Inp Gl` 0.02, `Opt Gl` 1.25 | OK |
| reasoningEffort | none, low, medium, high | footnote 7 (see gpt-5.4) | **FIX: drop `'none'`** |
| verbosity | low, medium, high | GPT-5 series verbosity | OK |
| maxOutputTokens / contextWindow | 128000 / 400000 | models-sold-directly: gpt-5.4-nano (2026-03-17) | OK |
| releaseDate | 2026-03-17 | Azure version `2026-03-17` | OK |

### azure/gpt-5.2

| Field | Current value | Source / evidence | Verdict |
| --- | --- | --- | --- |
| pricing | 1.75 / 0.175 / 14.0 | Retail API `GPT 5.2 inp Gl` 1.75, `cd inp Gl` 0.175, `opt Gl` 14.0 | OK |
| reasoningEffort | none, low, medium, high | footnote 7 explicitly lists gpt-5.2 as supporting `'none'`; `'xhigh'` removal (PR #4990) correct — codex-max only; `'minimal'` correctly absent ("not supported with gpt-5.1 or greater") | OK |
| verbosity | low, medium, high | GPT-5 series verbosity | OK |
| maxOutputTokens / contextWindow | 128000 / 400000 | models-sold-directly: gpt-5.2 (2025-12-11) | OK |
| releaseDate | 2025-12-11 | Azure version `2025-12-11` | OK |

### azure/gpt-5.1

| Field | Current value | Source / evidence | Verdict |
| --- | --- | --- | --- |
| pricing | 1.25 / 0.125 / 10.0 | Retail API `GPT 5.1 inp Gl` 1.25, `cd inp Gl` 0.125, `opt Gl` 10.0 | OK |
| reasoningEffort | none, low, medium, high | footnote 7 lists gpt-5.1 (also: `reasoning_effort` defaults to `none` on 5.1); `'minimal'` correctly absent | OK |
| verbosity | low, medium, high | GPT-5 series verbosity | OK |
| maxOutputTokens / contextWindow | 128000 / 400000 | models-sold-directly: gpt-5.1 | OK |
| releaseDate | 2025-11-12 | Azure version is **2025-11-13** in both the models table and the reasoning feature matrix | **FIX: → 2025-11-13** (per PR #4990's own convention of using the Azure version date, cf. gpt-4o 2024-11-20, model-router 2025-05-19) |

### azure/gpt-5.1-codex

| Field | Current value | Source / evidence | Verdict |
| --- | --- | --- | --- |
| pricing | 1.25 / 0.125 / 10.0 | Retail API `5.1 codex inp Gl` 1.25, `cd inp Gl` 0.125, `opt Gl` 10.0 | OK |
| reasoningEffort | none, low, medium, high | footnote 7 lists gpt-5.1-codex | OK |
| verbosity | low, medium, high | GPT-5 series | OK |
| maxOutputTokens / contextWindow | 128000 / 400000 | models-sold-directly: gpt-5.1-codex | OK |
| releaseDate | 2025-11-12 | Azure version `2025-11-13` | **FIX: → 2025-11-13** |
| deprecated | true (PR #4990 stopgap) | See ruling below | **RECOMMEND: KEEP entry, REVERT `deprecated: true`** |

**Ruling on open question (a):** Responses-API-only status **confirmed** — models-sold-directly lists gpt-5.1-codex as "Responses API only", and the reasoning feature matrix shows Chat Completions = not supported. **However, the premise that it "never worked through Sim" is false.** `apps/sim/providers/azure-openai/index.ts` dispatches by endpoint shape: a full chat-completions URL → Chat Completions; a full responses URL → Responses; **the default path (plain resource base URL) constructs `{endpoint}/openai/v1/responses` and calls the Responses API** (lines ~743–765). So gpt-5.1-codex works for any user configured with a base endpoint or responses URL — the majority configuration. Azure itself has not deprecated the model (GA, "Access is no longer restricted"). Therefore: **KEEP the entry and revert `deprecated: true`**. The only genuinely broken configuration is a user-supplied chat-completions endpoint URL; that is an endpoint-configuration limitation, not a model lifecycle state, and `deprecated` (which signals retirement to users) is the wrong tool for it.

### azure/gpt-5 · azure/gpt-5-mini · azure/gpt-5-nano

| Field | gpt-5 | gpt-5-mini | gpt-5-nano | Source / evidence | Verdict |
| --- | --- | --- | --- | --- | --- |
| pricing in/cached/out | 1.25 / 0.125 / 10.0 | 0.25 / 0.025 / 2.0 | 0.05 / 0.005 / 0.4 | Retail API `GPT 5 [Mini\|Nano] [Inpt\|cchd Inpt\|outpt] Glbl` — exact matches all three | OK |
| reasoningEffort | minimal, low, medium, high | same | same | reasoning doc: "`minimal` is only supported with the original GPT-5 reasoning models"; `'none'` correctly absent (not in footnote 7); `'xhigh'` correctly absent | OK |
| verbosity | low/medium/high | same | same | GPT-5 series | OK |
| maxOutputTokens / contextWindow | 128000 / 400000 | same | same | models-sold-directly: all three 400,000 (272k/128k) | OK |
| releaseDate | 2025-08-07 | 2025-08-07 | 2025-08-07 | Azure version `2025-08-07` | OK |

### azure/gpt-5-chat

| Field | Current value | Source / evidence | Verdict |
| --- | --- | --- | --- |
| id (deployable name) | `gpt-5-chat` | models-sold-directly lists `gpt-5-chat` (Preview), versions 2025-08-07 and 2025-10-03 — **exact name confirmed**; PR #4990 rename from `gpt-5-chat-latest` re-verified correct. Note: OpenAI's first-party `gpt-5-chat-latest`-style continuously-updated alias maps to a *different* Foundry product (`gpt-chat-latest`, now GPT-5.5 Instant) — our entry correctly tracks the deployable `gpt-5-chat` (open question e resolved) | OK |
| pricing | 1.25 / 0.125 / 10.0 | Retail API `GPT 5 Chat [Inpt\|cchd Inpt\|outpt] Glbl` = 1.25 / 0.125 / 10.0 | OK |
| temperature 0–2 | yes | gpt-5-chat is a non-reasoning chat model (temperature restriction applies to gpt-5.1-chat and later, which we do not list) | OK |
| maxOutputTokens | 16384 | models-sold-directly: 128,000 / **16,384** (PR #4990 addition re-verified) | OK |
| contextWindow | 128000 | same row | OK |
| releaseDate | 2025-08-07 | Azure version `2025-08-07` (a `2025-10-03` revision also exists; the original version date is kept) | OK |
| lifecycle | not marked | **Preview** on Azure. Preview lifecycle = "not sooner than" retirement, force-upgrade or 30-day-notice retirement, "not recommended for production". No retirement date currently announced → no `deprecated` flag warranted | OK (documented) |

### azure/o3 · azure/o4-mini

| Field | o3 | o4-mini | Source / evidence | Verdict |
| --- | --- | --- | --- | --- |
| pricing | 2 / 0.5 / 8 | 1.1 / 0.275 / 4.4 | Retail API `o3 0416` 0.002/0.0005/0.008 per 1K; `o4-mini 0416` 0.0011/0.000275/0.0044 per 1K | OK |
| reasoningEffort | low, medium, high | low, medium, high | reasoning doc: "low, medium, or high for all reasoning models except o1-mini"; o-series matrix has no none/minimal/xhigh | OK |
| verbosity | (absent) | (absent) | verbosity is a GPT-5-series-only parameter | OK |
| maxOutputTokens / contextWindow | 100000 / 200000 | 100000 / 200000 | models-sold-directly o-series: Input 200,000 / Output 100,000 | OK |
| releaseDate | 2025-04-16 | 2025-04-16 | Azure version `2025-04-16` for both | OK |

### azure/gpt-4.1 · azure/gpt-4.1-mini · azure/gpt-4.1-nano

| Field | 4.1 | 4.1-mini | 4.1-nano | Source / evidence | Verdict |
| --- | --- | --- | --- | --- | --- |
| pricing | 2.0 / 0.5 / 8.0 | 0.4 / 0.1 / 1.6 | 0.1 / 0.025 / 0.4 | Retail API `gpt 4.1 [mini\|nano] [Inp\|cached Inp\|Outp] glbl` — exact matches all three | OK |
| temperature 0–2 | yes | yes | yes | non-reasoning models | OK |
| maxOutputTokens | 32768 | 32768 | 32768 | models-sold-directly: 32,768 | OK |
| contextWindow | 1047576 | 1047576 | 1047576 | models-sold-directly: 1,047,576 (global standard; lower for regional standard/batch — global is the right representation) | OK |
| releaseDate | 2025-04-14 | 2025-04-14 | 2025-04-14 | Azure version `2025-04-14` | OK |

### azure/model-router

| Field | Current value | Source / evidence | Verdict |
| --- | --- | --- | --- |
| pricing | 2.0 / 0.5 / 8.0 | No `model-router` meter exists in the Retail Prices API (searched `Router`/`Rtr`/`rtr` under serviceName 'Foundry Models' and productName across all services — only Communication Services "Job Router" exists). Concepts page: "Model router usage is charged for input prompts at the rate listed on the pricing page"; how-to evaluation section: "Account for the **router markup on input tokens** plus the underlying model's input and output pricing." The reported $0.14/1M router markup could not be confirmed from any fetchable source (only the timing-out marketing page carries the number). | **KEEP as documented proxy** (open question d resolved — see below) |
| capabilities | {} (no reasoningEffort) | Router accepts `reasoning_effort` since version 2025-11-18 and forwards it; but our pinned version semantics are 2025-05-19 (gpt-4.1-family + o4-mini routing, none of which take temperature uniformly — temp/top_p silently dropped for o-series). Empty capabilities is the safest representation | OK |
| contextWindow | 200000 | models-sold-directly footnote: "Context window: 200,000" — the limit of the smallest underlying model; larger prompts succeed only if routed to a compatible model | OK |
| maxOutputTokens | (absent) | "max output tokens varies" (16,384–128,000 depending on routed model) — correctly unset | OK |
| releaseDate | 2025-05-19 | Original version `2025-05-19` confirmed (versions: 2025-05-19, 2025-08-07, 2025-11-18 latest); PR #4990 change re-verified | OK |

**Pricing decision (open question d):** True billing = per-input-token router markup + the routed model's own input/output rates, which varies per request. The flat `{input, cachedInput, output}` schema cannot express this. The current 2.0/0.5/8.0 equals the gpt-4.1 rates — gpt-4.1 is the flagship of the 2025-05-19 routed set (gpt-4.1/-mini/-nano + o4-mini) and sits at the cost ceiling of that set alongside o3-class o4-mini rates, so it is a conservative (slightly pessimistic) proxy for cost estimation. **Keep 2.0/0.5/8.0.** This is a documented schema limitation, not a verified Azure price; cost estimates for model-router workloads in Sim are approximations.

---

## Block: `azure-anthropic` (defaultModel: `azure-anthropic/claude-sonnet-4-5`)

Pricing basis: platform.claude.com Claude-in-Microsoft-Foundry doc — "Pricing for Claude in the Microsoft Marketplace uses Anthropic's standard API pricing." So azure-anthropic pricing == Anthropic first-party pricing (open question f, pricing half, resolved). `cachedInput` maps to Anthropic "Cache Hits & Refreshes" (0.1× input). All five models are **(preview)** on Foundry; Foundry "follows the Claude API lifecycle schedule".

### azure-anthropic/claude-opus-4-6

| Field | Current value | Source / evidence | Verdict |
| --- | --- | --- | --- |
| pricing | 5.0 / 0.5 / 25.0 | Anthropic pricing: Opus 4.6 $5 in / $0.50 cache read / $25 out | OK |
| contextWindow | 1000000 | MS Foundry Claude doc: opus-4-6 "1M / 128K"; Anthropic Foundry doc: "Claude Fable 5, Claude Opus 4.7, Claude Opus 4.6, and Claude Sonnet 4.6 have a 1M-token context window on Microsoft Foundry"; Anthropic models overview: 1M. PR #4990 change re-verified. Long context is at **standard pricing** (Anthropic long-context pricing section), so no tiered-pricing concern | OK |
| maxOutputTokens | 128000 | both MS and Anthropic sources: 128K | OK |
| thinking levels | low, medium, high, max (default high) | MS Foundry Claude doc: effort supports low/medium/high, "also max for Opus 4.8, Opus 4.7, **Opus 4.6**, and Sonnet 4.6" | OK |
| nativeStructuredOutputs | true | Anthropic structured-outputs doc: Opus 4.6 supported (GA) | OK |
| temperature 0–1 | yes | Anthropic Messages API range | OK |
| releaseDate | 2026-02-05 | Not stated in any fetched doc (dateless model ID). Consistent with Opus 4.6 launch timeframe (early Feb 2026); convention = announcement date | Unverifiable (plausible, kept) |

### azure-anthropic/claude-opus-4-5

| Field | Current value | Source / evidence | Verdict |
| --- | --- | --- | --- |
| pricing | 5.0 / 0.5 / 25.0 | Anthropic pricing: Opus 4.5 $5 / $0.50 / $25 | OK |
| contextWindow / maxOutputTokens | 200000 / 64000 | MS doc "200K / 64K"; Anthropic overview 200k / 64k | OK |
| thinking | low, medium, high | extended thinking; `max` effort not supported on 4.5-generation | OK |
| nativeStructuredOutputs | true | Anthropic structured-outputs doc: Opus 4.5 supported | OK |
| releaseDate | 2025-11-24 | Anthropic launch date (snapshot ID claude-opus-4-5-20251101; announcement 2025-11-24 — announcement-date convention) | OK |

### azure-anthropic/claude-sonnet-4-5

| Field | Current value | Source / evidence | Verdict |
| --- | --- | --- | --- |
| pricing | 3.0 / 0.3 / 15.0 | Anthropic pricing: Sonnet 4.5 $3 / $0.30 / $15 | OK |
| contextWindow / maxOutputTokens | 200000 / 64000 | MS doc "200K / 64K"; Anthropic overview. Note: the Sonnet 4.5 **1M-context beta** on Foundry retires after 2026-04-30 (already past) — 200000 is correct | OK |
| thinking | low, medium, high | extended thinking | OK |
| nativeStructuredOutputs | true | Anthropic structured-outputs doc: Sonnet 4.5 supported | OK |
| releaseDate | 2025-09-29 | snapshot claude-sonnet-4-5-20250929 | OK |

### azure-anthropic/claude-opus-4-1

| Field | Current value | Source / evidence | Verdict |
| --- | --- | --- | --- |
| pricing | 15.0 / 1.5 / 75.0 | Anthropic pricing: Opus 4.1 $15 / $1.50 / $75 | OK |
| contextWindow / maxOutputTokens | 200000 / 32000 | MS doc "200K / 32K"; Anthropic overview 200k / 32k | OK |
| thinking | low, medium, high | extended thinking | OK |
| nativeStructuredOutputs | **true** | Anthropic structured-outputs doc supported-model list **excludes Opus 4.1** (Fable 5, Mythos 5/Preview, Opus 4.8/4.7/4.6/4.5, Sonnet 4.6/4.5, Haiku 4.5 only). The first-party `anthropic` block's `claude-opus-4-1` entry correctly omits it (models.ts ~line 762). With this flag set, Sim sends the `structured-outputs-2025-11-13` beta header and `output_format` to a model that doesn't support it | **FIX: remove `nativeStructuredOutputs`** |
| deprecated | true | Anthropic Foundry doc model table: "Claude Opus 4.1 — Deprecated. **Retiring August 5, 2026**"; Anthropic pricing page marks it deprecated. PR #4990 change re-verified correct | OK |
| releaseDate | 2025-08-05 | snapshot claude-opus-4-1-20250805 | OK |

### azure-anthropic/claude-haiku-4-5

| Field | Current value | Source / evidence | Verdict |
| --- | --- | --- | --- |
| pricing | 1.0 / 0.1 / 5.0 | Anthropic pricing: Haiku 4.5 $1 / $0.10 / $5 | OK |
| contextWindow / maxOutputTokens | 200000 / 64000 | MS doc "200K / 64K"; Anthropic overview | OK |
| thinking | low, medium, high | extended thinking | OK |
| nativeStructuredOutputs | true | Anthropic structured-outputs doc: Haiku 4.5 supported | OK |
| releaseDate | 2025-10-15 | Anthropic launch date (snapshot claude-haiku-4-5-20251001; announcement 2025-10-15 — announcement-date convention) | OK |

---

## Changes made in PR #4990 — re-verification results

| PR #4990 change | Verdict |
| --- | --- |
| Drop `'xhigh'` from azure/gpt-5.4, 5.4-mini, 5.4-nano, gpt-5.2 | **Correct** — `xhigh` is gpt-5.1-codex-max only (reasoning doc footnote 6) |
| `deprecated: true` on azure/gpt-5.1-codex | **Premise partially wrong** — Responses-API-only confirmed, but Sim's azure provider defaults to the Responses API; recommend reverting (see entry) |
| `deprecated: true` on azure-anthropic/claude-opus-4-1 | **Correct** — retiring 2026-08-05 |
| Rename azure/gpt-5-chat-latest → azure/gpt-5-chat + maxOutputTokens 16384 | **Correct** |
| azure/gpt-4o releaseDate → 2024-11-20 | **Correct** |
| azure/model-router releaseDate → 2025-05-19 | **Correct** |
| azure-anthropic/claude-opus-4-6 contextWindow → 1000000 | **Correct** |
| updatedAt bumps to 2026-06-11 | OK (azure/model-router still 2026-04-01; acceptable since its pricing is an unverifiable proxy) |

## Recommended fixes from this pass (not applied — doc only)

1. `azure/gpt-5.4`, `azure/gpt-5.4-mini`, `azure/gpt-5.4-nano`: reasoningEffort drop `'none'` → `['low','medium','high']` (reasoning doc footnote 7 enumerates 'none' support and excludes the 5.4 family).
2. `azure/gpt-4o`: add `maxOutputTokens: 16384`.
3. `azure/gpt-4o`: add `deprecated: true` (retires 2026-10-01). **Product caveat:** it is the block's `defaultModel`; the default-model change is a product decision, not made here.
4. `azure/gpt-5.1` and `azure/gpt-5.1-codex`: releaseDate `2025-11-12` → `2025-11-13` (Azure version date convention).
5. `azure/gpt-5.1-codex`: **KEEP entry; revert `deprecated: true`** (works through Sim's default Responses-API path; Azure lifecycle is GA, not deprecated).
6. `azure-anthropic/claude-opus-4-1`: remove `nativeStructuredOutputs: true` (unsupported model; matches first-party anthropic entry).

## Deliberately not changed

- **azure/model-router pricing 2.0/0.5/8.0** — kept as a documented gpt-4.1-rate proxy; real billing (input-token router markup + routed model rates) is unrepresentable in the flat pricing schema, and no router meter exists in the Retail Prices API to anchor a different number.
- **azure/gpt-5-chat Preview status** — no `deprecated` flag: Preview models have no announced retirement; flagging would misrepresent lifecycle.
- **gpt-5.4 long-context pricing tier** (5.0/0.5/22.5 "longco" meters) — schema cannot express tiered pricing; standard-tier rates kept.
- **gpt-4.1 contextWindow 1,047,576** — global-standard figure kept although regional standard (300,000) and batch (128,000) deployments are lower; Sim assumes global standard.
- **azure-anthropic releaseDates using announcement dates** (opus-4-5 2025-11-24, haiku-4-5 2025-10-15) rather than snapshot dates (20251101, 20251001) — consistent existing convention across the file.
- **Missing newer models** (out of scope, noted for follow-up): Azure now offers `gpt-5.5` (GA, 2026-04-24, 1.05M ctx), `gpt-chat-latest`, `gpt-5.4-pro`, `gpt-5.3-codex`/`gpt-5.3-chat`, `gpt-5.2-codex`/`gpt-5.2-chat`; Foundry Claude now offers `claude-fable-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-4-6` (1M ctx GA).

## Unverifiable

- **model-router pricing** — no retail meter; the $0.14/1M router-markup figure appears only on the timing-out marketing pricing page and could not be confirmed.
- **azure-anthropic/claude-opus-4-6 releaseDate 2026-02-05** — no fetched source states the launch date (dateless model ID); plausible and consistent with Opus 4.6-era documentation, kept as-is.
- **Azure-side rate-limit/quota values** — not modeled in the schema; not validated.
