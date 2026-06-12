# OpenAI Provider Block — Final Validation & Justification

**Validation date:** 2026-06-11
**Scope:** `openai` provider block in `apps/sim/providers/models.ts` (23 models), including changes landed in PR #4990.
**Method:** Live WebFetch of every individual model page on `developers.openai.com/api/docs/models/<id>`, the pricing page, the reasoning guide, the GPT-5.5 usage guide, the deprecations page, and the API reference; secondary pricing cross-checks against OpenRouter. All claims below were fetched live this session. Provider docs win over secondary sources.

**Sources:**

- Pricing: https://developers.openai.com/api/docs/pricing (only lists current gpt-5.5/5.4 families; per-model pricing taken from individual model pages)
- Model pages: `https://developers.openai.com/api/docs/models/<model-id>` (fetched for all 23 ids)
- Reasoning guide: https://developers.openai.com/api/docs/guides/reasoning
- GPT-5.5 usage guide: https://developers.openai.com/api/docs/guides/latest-model
- Deprecations: https://developers.openai.com/api/docs/deprecations
- GPT-5.5 launch: https://openai.com/index/introducing-gpt-5-5/ (via search; release 2026-04-23, API availability 2026-04-24)
- Secondary pricing: https://openrouter.ai/openai/gpt-5.5, /gpt-5.5-pro, /gpt-5.4, /gpt-5.2, /o3, /gpt-4o — all consistent with provider docs

**Flag consumption check** (`rg` over `apps/sim/providers/openai/`): `reasoningEffort` and `verbosity` are consumed in `apps/sim/providers/openai/core.ts` (sent as `reasoning.effort` / `text.verbosity` on the Responses API). `nativeStructuredOutputs` is NOT consumed by the provider runtime — its only consumer is the landing models page (`apps/sim/app/(landing)/models/utils.ts`), so it is display-only metadata. `thinking` / `computerUse` are not used by the OpenAI provider.

Pricing is USD per 1M tokens throughout. "MP" = the model's own docs page (`developers.openai.com/api/docs/models/<id>`).

---

## Per-model verification

### gpt-4.1

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 2.0 / 0.5 / 8.0 | MP gpt-4.1 | ✓ verified |
| updatedAt | 2026-06-11 | this validation | ✓ verified today |
| contextWindow | 1,047,576 | MP: "1,047,576 tokens" | ✓ verified |
| maxOutputTokens | 32,768 | MP | ✓ verified |
| temperature 0–2 | present | non-reasoning chat model; standard OpenAI sampling range | ✓ correct by convention (docs do not enumerate the range; 0–2 is the API-wide bound) |
| releaseDate | 2025-04-14 | MP snapshot `gpt-4.1-2025-04-14` | ✓ verified |
| deprecated | absent | deprecations page does not list gpt-4.1 base | ✓ verified active ("Default", "Smartest non-reasoning model") |

### gpt-4.1-mini

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 0.4 / 0.1 / 1.6 | MP gpt-4.1-mini | ✓ verified |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 1,047,576 / 32,768 | MP | ✓ verified |
| temperature 0–2 | present | convention (non-reasoning) | ✓ |
| releaseDate | 2025-04-14 | MP snapshot `gpt-4.1-mini-2025-04-14` | ✓ verified |
| deprecated | absent | not on deprecations page | ✓ verified |

### gpt-4.1-nano

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 0.1 / 0.025 / 0.4 | MP gpt-4.1-nano | ✓ verified |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 1,047,576 / 32,768 | MP | ✓ verified |
| temperature 0–2 | present | convention | ✓ |
| releaseDate | 2025-04-14 | MP (snapshot `gpt-4.1-nano-2025-04-14`, now marked deprecated) | ✓ verified |
| deprecated | **absent — should be `true`** | deprecations page: shutdown **2026-10-23**, replacement gpt-5.4-nano; MP also recommends "starting with GPT-5 nano" | **FIX: add `deprecated: true`** |

### gpt-5.5-pro

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / output | 30.0 / 180.0 | MP + pricing page + OpenRouter | ✓ verified (two sources) |
| cachedInput | absent | MP: "GPT-5.5 Pro does not offer a cached input discount" | ✓ verified correct omission |
| updatedAt | **2026-04-23 — stale** | pricing re-verified 2026-06-11 this session | **FIX: bump to 2026-06-11** (PR #4990 claimed to bump all entries but missed this one) |
| contextWindow | 1,050,000 | MP: "1,050,000 context window" | ✓ verified |
| maxOutputTokens | 128,000 | MP | ✓ verified |
| nativeStructuredOutputs | true | MP: "Structured outputs: Supported" | ✓ verified (display-only flag) |
| reasoningEffort | **['none','low','medium','high','xhigh'] — wrong** | see Open Question (a) below | **FIX: change to `['medium','high','xhigh']`** |
| verbosity | **present — should be removed** | see Open Question (b) below | **FIX: remove `verbosity` block** |
| releaseDate | 2026-04-23 | MP snapshot `gpt-5.5-pro-2026-04-23` | ✓ verified |
| deprecated | absent | no deprecation notes on MP | ✓ verified |

**Open Question (a) — resolved.** The gpt-5.5-pro model page does NOT enumerate reasoning effort values (fetched twice, explicitly asked for any sentence containing "effort" — the page contains no `reasoning.effort` enumeration). The reasoning guide says values are model-dependent and "check the relevant model page". Direct documentation for the siblings is explicit: gpt-5.4-pro MP — "supports reasoning.effort: medium, high, xhigh"; gpt-5.2-pro MP — "supports reasoning.effort: medium, high, xhigh"; gpt-5-pro MP — "defaults to (and only supports) reasoning.effort: high". Every pro-tier model that documents the parameter excludes `none` and `low` — the pro tier exists to "use more compute to think harder" (gpt-5.5-pro MP), making `none`/`low` incoherent with the product. The most defensible value set is **`['medium','high','xhigh']`**, matching both documented pro siblings. The current `['none','low','medium','high','xhigh']` appears copied from non-pro gpt-5.5 and is backed by no source.

**Open Question (b) — resolved.** Not documented. The gpt-5.5-pro page does not mention `verbosity` (explicitly checked). No pro-tier model page (gpt-5.4-pro, gpt-5.2-pro, gpt-5-pro) documents verbosity, and the GPT-5.5 usage guide discusses `text.verbosity` only for gpt-5.5. Since `verbosity` is runtime-consumed (`core.ts` sends `text.verbosity` to the API), advertising it on a model that may reject it is a live failure risk. **Remove the verbosity block from gpt-5.5-pro.**

### gpt-5.5

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 5.0 / 0.5 / 30.0 | MP + pricing page + OpenRouter | ✓ verified (two sources) |
| updatedAt | **2026-04-23 — stale** | re-verified 2026-06-11 | **FIX: bump to 2026-06-11** (missed by PR #4990) |
| contextWindow / maxOutputTokens | 1,050,000 / 128,000 | MP | ✓ verified |
| nativeStructuredOutputs | true | MP: structured outputs supported | ✓ verified |
| reasoningEffort ['none','low','medium','high','xhigh'] | present | MP: "Reasoning.effort supports: none, low, medium (default), high and xhigh" | ✓ verified verbatim |
| verbosity ['low','medium','high'] | present | GPT-5.5 usage guide documents `text.verbosity` (recommends `low` for concise) | ✓ verified |
| releaseDate | 2026-04-23 | announcement 2026-04-23 (openai.com/index/introducing-gpt-5-5/, TechCrunch); pro sibling snapshot is `-2026-04-23` | ✓ verified (note: API availability was 2026-04-24; snapshot naming uses 04-23) |
| recommended | true | flagship per OpenAI ("latest GPT-5.5" is the recommended upgrade target on gpt-5.2/gpt-5/o3 pages) | ✓ intentional, docs-consistent |

### gpt-5.4-pro

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / output | 30.0 / 180.0 | MP + pricing page | ✓ verified (note: MP — ">272K input tokens are priced at 2x input and 1.5x output"; the flat-rate model in `models.ts` cannot express this; under-bills long-context pro calls — pre-existing limitation, see Unverifiable/limitations) |
| cachedInput | absent | pricing page shows no cached rate for pro | ✓ verified |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 1,050,000 / 128,000 | MP | ✓ verified |
| reasoningEffort ['medium','high','xhigh'] | present | MP: "supports reasoning.effort: medium, high, xhigh" | ✓ verified verbatim |
| verbosity | absent | not documented for pro | ✓ correct omission |
| releaseDate | 2026-03-05 | gpt-5.4 snapshot `gpt-5.4-2026-03-05`; same launch | ✓ verified |
| deprecated | absent | none | ✓ |

### gpt-5.4

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 2.5 / 0.25 / 15.0 | MP + pricing page + OpenRouter | ✓ verified (two sources) |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 1,050,000 / 128,000 | MP | ✓ verified |
| reasoningEffort ['none','low','medium','high','xhigh'] | present | MP: "Reasoning.effort supports: none (default), low, medium, high and xhigh" | ✓ verified verbatim |
| verbosity ['low','medium','high'] | present | not on MP; carried from GPT-5-line `text.verbosity` parameter (documented in usage guide / help center for the GPT-5 family) | ✓ kept — see "Deliberately not changed" |
| releaseDate | 2026-03-05 | MP snapshot `gpt-5.4-2026-03-05` | ✓ verified |

### gpt-5.4-mini

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 0.75 / 0.075 / 4.5 | MP + pricing page | ✓ verified |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 400,000 / 128,000 | MP | ✓ verified |
| reasoningEffort ['none','low','medium','high','xhigh'] | present | gpt-5.4 family per search-confirmed docs: "gpt-5.4, gpt-5.4-mini, and gpt-5.4-nano support none, low, medium, high, and xhigh" | ✓ verified |
| verbosity | present | family convention | ✓ kept |
| releaseDate | 2026-03-17 | MP snapshot `gpt-5.4-mini-2026-03-17` | ✓ verified |

### gpt-5.4-nano

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 0.2 / 0.02 / 1.25 | MP + pricing page | ✓ verified |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 400,000 / 128,000 | MP | ✓ verified |
| reasoningEffort / verbosity | as gpt-5.4-mini | same family docs | ✓ verified / kept |
| releaseDate | 2026-03-17 | MP snapshot `gpt-5.4-nano-2026-03-17` | ✓ verified |
| speedOptimized | true | MP: "cheapest GPT-5.4-class model", optimized for classification/extraction/sub-agents | ✓ intentional repo flag, consistent with docs |

### gpt-5.2-pro

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / output | 21.0 / 168.0 | MP | ✓ verified |
| cachedInput | absent | MP shows none | ✓ |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 400,000 / 128,000 | MP | ✓ verified |
| reasoningEffort ['medium','high','xhigh'] | present | MP: "supports reasoning.effort: medium, high, xhigh" | ✓ verified verbatim |
| releaseDate | 2025-12-11 | MP snapshot `gpt-5.2-pro-2025-12-11` | ✓ verified |
| deprecated | absent | MP recommends upgrading to gpt-5.5-pro but no shutdown date on deprecations page | ✓ verified (soft-superseded, not deprecated) |

### gpt-5.2

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 1.75 / 0.175 / 14.0 | MP + OpenRouter | ✓ verified (two sources) |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 400,000 / 128,000 | MP | ✓ verified |
| reasoningEffort ['none','low','medium','high','xhigh'] | present | MP: "none (default), low, medium, high and xhigh" | ✓ verified verbatim |
| verbosity | present | family convention | ✓ kept |
| releaseDate | 2025-12-11 | MP snapshot `gpt-5.2-2025-12-11` | ✓ verified |
| deprecated | absent | superseded by 5.5 but no shutdown (only `gpt-5.2-chat-latest` has one) | ✓ verified |

### gpt-5.1

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 1.25 / 0.125 / 10.0 | MP | ✓ verified |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 400,000 / 128,000 | MP | ✓ verified |
| reasoningEffort ['none','low','medium','high'] | present | MP: "Reasoning.effort supports: none (default), low, medium, and high" (no xhigh) | ✓ verified verbatim |
| verbosity | present | family convention | ✓ kept |
| releaseDate | **2025-11-12** | MP snapshot is `gpt-5.1-2025-11-13` | **FIX: → 2025-11-13.** Repo convention everywhere else in this block is snapshot date (gpt-5-pro 10-06, gpt-5.2 12-11, gpt-4.1 04-14, o3-pro 06-10, …). 2025-11-12 is the announcement date; the API snapshot is 11-13 |

### gpt-5-pro

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / output | 15.0 / 120.0 | MP | ✓ verified |
| cachedInput | absent | MP shows none | ✓ |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow | 400,000 | MP | ✓ verified |
| maxOutputTokens | 272,000 | MP: "272,000 max output tokens" | ✓ verified (yes, it really is larger than the rest of the family) |
| reasoningEffort ['high'] | present | MP: "defaults to (and only supports) `reasoning.effort: high`" | ✓ verified verbatim |
| releaseDate | 2025-10-06 | MP snapshot `gpt-5-pro-2025-10-06` | ✓ verified — **PR #4990's change confirmed correct** |
| deprecated | absent | none listed | ✓ |

### gpt-5

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 1.25 / 0.125 / 10.0 | MP | ✓ verified |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 400,000 / 128,000 | MP | ✓ verified |
| reasoningEffort ['minimal','low','medium','high'] | present | MP: "minimal, low, medium, and high"; reasoning guide confirms `minimal` introduced with GPT-5 | ✓ verified verbatim |
| verbosity | present | verbosity launched with GPT-5 | ✓ verified |
| releaseDate | 2025-08-07 | MP snapshot `gpt-5-2025-08-07` | ✓ verified |
| deprecated | absent | MP: "We recommend using the latest GPT-5.5" but no shutdown date — deprecations page: "not explicitly listed as deprecated" | ✓ verified (superseded, not deprecated) |

### gpt-5-mini

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 0.25 / 0.025 / 2.0 | MP | ✓ verified |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 400,000 / 128,000 | MP | ✓ verified |
| reasoningEffort / verbosity | gpt-5 family values | GPT-5 family launch docs | ✓ verified |
| releaseDate | 2025-08-07 | MP snapshot `gpt-5-mini-2025-08-07` | ✓ verified |

### gpt-5-nano

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 0.05 / 0.005 / 0.4 | MP | ✓ verified |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 400,000 / 128,000 | MP | ✓ verified |
| reasoningEffort / verbosity | gpt-5 family values | family docs | ✓ verified |
| releaseDate | 2025-08-07 | MP snapshot `gpt-5-nano-2025-08-07` | ✓ verified |

### gpt-5-chat-latest

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 1.25 / 0.125 / 10.0 | MP | ✓ verified |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 128,000 / 16,384 | MP | ✓ verified |
| temperature 0–2 | present | non-reasoning chat snapshot | ✓ convention |
| releaseDate | 2025-08-07 | GPT-5 launch snapshot | ✓ verified |
| deprecated | true | **deprecations page: shutdown 2026-07-23, replacement gpt-5.5** | ✓ verified — **PR #4990's change confirmed correct and now formally docs-backed** |

### o4-mini

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 1.1 / 0.275 / 4.4 | MP | ✓ verified |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 200,000 / 100,000 | MP | ✓ verified |
| reasoningEffort ['low','medium','high'] | present | see Open Question (c) below | ✓ verified |
| releaseDate | 2025-04-16 | MP snapshot `o4-mini-2025-04-16` | ✓ verified |
| deprecated | true | deprecations page: shutdown **2026-10-23**, replacement gpt-5.4-mini; MP: snapshot Deprecated, "succeeded by GPT-5 mini" | ✓ verified — **PR #4990's change confirmed correct** |

### o3-pro

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / output | 20.0 / 80.0 | MP | ✓ verified |
| cachedInput | absent | MP shows none | ✓ |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 200,000 / 100,000 | MP | ✓ verified |
| reasoningEffort | absent | MP: "Reasoning: Highest", no effort enum documented (pro pattern: fixed high effort) | ✓ correct omission |
| releaseDate | 2025-06-10 | MP snapshot `o3-pro-2025-06-10` | ✓ verified |
| deprecated | absent | deprecations page does not list o3-pro (only o3/o3-mini) | ✓ verified — note the oddity that base o3 is scheduled for shutdown while o3-pro is not; evidence-based, leave as is |

### o3

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 2 / 0.5 / 8 | MP + OpenRouter ($2/$8) | ✓ verified (two sources) |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 200,000 / 100,000 | MP | ✓ verified |
| reasoningEffort ['low','medium','high'] | present | Open Question (c) | ✓ verified |
| releaseDate | 2025-04-16 | MP snapshot `o3-2025-04-16` | ✓ verified |
| deprecated | **absent — should be `true`** | **deprecations page: shutdown 2026-10-23**, replacement gpt-5.5-pro; MP: "superseded by GPT-5" | **FIX: add `deprecated: true`** |

### o3-mini

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 1.1 / 0.55 / 4.4 | MP (note: cachedInput 0.55 differs from o4-mini's 0.275 — both verified correct per their MPs) | ✓ verified |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 200,000 / 100,000 | MP | ✓ verified |
| reasoningEffort ['low','medium','high'] | present | o3-mini launch post: "three reasoning effort options—low, medium, and high" | ✓ verified explicitly |
| releaseDate | 2025-01-31 | MP snapshot `o3-mini-2025-01-31` | ✓ verified |
| deprecated | **absent — should be `true`** | **deprecations page: shutdown 2026-10-23**, replacement gpt-5.5; MP: snapshot marked deprecated | **FIX: add `deprecated: true`** |

### o1

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 15.0 / 7.5 / 60 | MP | ✓ verified |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 200,000 / 100,000 | MP | ✓ verified |
| reasoningEffort ['low','medium','high'] | present | Open Question (c) | ✓ verified |
| releaseDate | **2024-12-05** | MP snapshot is `o1-2024-12-17` | **FIX (minor): → 2024-12-17** for snapshot-date consistency. 2024-12-05 is the ChatGPT launch; the API snapshot (the convention used by every other entry in this block) is 12-17 |
| deprecated | **absent — recommend `true`** | MP: sole snapshot `o1-2024-12-17` explicitly "Deprecated"; described as "Previous full o-series reasoning model". Base alias not on the deprecations shutdown table (only o1-preview/o1-mini, already shut down) | **FIX (recommended): add `deprecated: true`** — weaker evidence than o3/o3-mini (no shutdown date for the alias), but its only snapshot is deprecated and every other o-series peer is deprecated |

**Open Question (c) — resolved.** The current model pages no longer enumerate `reasoning_effort` for the o-series, and the Responses API reference page content does not surface the enum inline. The reasoning guide states: "Supported values are model-dependent and can include `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`... check the relevant model page." Best available evidence: (1) o3-mini launch post (openai.com/index/openai-o3-mini/) explicitly: "three reasoning effort options—low, medium, and high"; (2) the API changelog notes `reasoning_effort` was added for o1 models with those three values; (3) `none`/`minimal`/`xhigh` were introduced with the GPT-5 line and were never back-ported to o-series. **`['low','medium','high']` for o1, o3, o3-mini, o4-mini is confirmed — no change.**

### gpt-4o

| Field | Value | Source | Verdict |
|---|---|---|---|
| input / cachedInput / output | 2.5 / 1.25 / 10.0 | MP + OpenRouter ($2.50/$10) | ✓ verified (two sources) |
| updatedAt | 2026-06-11 | this validation | ✓ |
| contextWindow / maxOutputTokens | 128,000 / 16,384 | MP | ✓ verified |
| temperature 0–2 | present | convention | ✓ |
| releaseDate | 2024-05-13 | MP snapshot `gpt-4o-2024-05-13`; OpenRouter "released May 13, 2024" | ✓ verified |
| deprecated | true | see Open Question (d) | ✓ verified — and now docs-backed |

**Open Question (d) — resolved, better than expected.** The brief said gpt-4o is "active per OpenAI" and `deprecated: true` is a deliberate steering decision. The live deprecations page now shows **gpt-4o: shutdown 2026-10-23, replacement gpt-5.5**. So `deprecated: true` is no longer just an intentional product deviation — it is officially correct. Keep, no caveat needed.

---

## Open Question (e) — `defaultModel: 'gpt-4.1'`

OpenAI's flagship is gpt-5.5 (announcement 2026-04-23; the gpt-5.2/gpt-5/o3 pages all point at "the latest GPT-5.5"). gpt-4.1 remains active (it is OpenAI's "smartest non-reasoning model" and is not on the deprecations page), so the current default is not broken — it is a cheap, fast, temperature-supporting non-reasoning default, which is a defensible UX choice for new blocks. **Recommendation:** consider `defaultModel: 'gpt-5.5'` (or `gpt-5.4-mini` for a cost-conscious reasoning default) to match the flagship, but this is a **product decision**, not a correctness fix — not included in the machine-applyable list.

---

## Changes made in this pass (recommended to apply now)

1. **gpt-5.5-pro** — `reasoningEffort.values`: `['none','low','medium','high','xhigh']` → `['medium','high','xhigh']`. Undocumented on its own page; both documented pro siblings (gpt-5.4-pro, gpt-5.2-pro) enumerate exactly `medium, high, xhigh`; pro tier semantics exclude none/low. Sending `reasoning.effort: 'none'` to a pro model risks a 400.
2. **gpt-5.5-pro** — remove the `verbosity` block. Not documented for any pro model; the provider sends `text.verbosity` at runtime, so advertising it is a live API-error risk.
3. **gpt-5.5-pro** — `pricing.updatedAt`: `2026-04-23` → `2026-06-11` (re-verified today; PR #4990 missed this entry despite claiming an all-entry bump).
4. **gpt-5.5** — `pricing.updatedAt`: `2026-04-23` → `2026-06-11` (same).
5. **o3** — add `deprecated: true` (official shutdown 2026-10-23).
6. **o3-mini** — add `deprecated: true` (official shutdown 2026-10-23).
7. **gpt-4.1-nano** — add `deprecated: true` (official shutdown 2026-10-23, replacement gpt-5.4-nano).
8. **o1** — add `deprecated: true` (sole snapshot `o1-2024-12-17` marked Deprecated; "previous" o-series model; recommended, slightly weaker evidence).
9. **gpt-5.1** — `releaseDate`: `2025-11-12` → `2025-11-13` (snapshot `gpt-5.1-2025-11-13`; snapshot-date convention).
10. **o1** — `releaseDate`: `2024-12-05` → `2024-12-17` (snapshot `o1-2024-12-17`; snapshot-date convention; minor).

## Deliberately not changed

- **gpt-4o `deprecated: true`** — originally an intentional steering decision; now officially correct (shutdown 2026-10-23). Keep.
- **gpt-5-chat-latest / o4-mini `deprecated: true`** (PR #4990) — both confirmed by the deprecations page (2026-07-23 and 2026-10-23 shutdowns). Keep.
- **`defaultModel: 'gpt-4.1'`** — product decision; gpt-4.1 is active. Flagged for product review (gpt-5.5 is the flagship), not a correctness fix.
- **`verbosity` on non-pro gpt-5.x models (gpt-5.4/-mini/-nano, gpt-5.2, gpt-5.1, gpt-5 family)** — current model pages don't enumerate it per-model, but `text.verbosity` is a documented GPT-5-line parameter (GPT-5 launch; GPT-5.5 usage guide; OpenAI help center) and the provider has been sending it without errors. Keep.
- **`temperature {0,2}` on gpt-4.1 family, gpt-4o, gpt-5-chat-latest** — model pages don't state sampling ranges; 0–2 is the documented API-wide range for non-reasoning chat models. Correct by convention.
- **o3-pro not deprecated** — the deprecations page lists o3 and o3-mini but not o3-pro. Odd but evidence-based; leave.
- **gpt-5.2 / gpt-5 / gpt-5.2-pro not deprecated** — docs say "superseded / recommend GPT-5.5" but list no shutdown; superseded ≠ deprecated. Leave.
- **`recommended: true` on gpt-5.5 and `speedOptimized: true` on gpt-5.4-nano** — repo-internal flags, consistent with docs positioning.
- **o3-mini `cachedInput: 0.55` vs o4-mini `0.275`** — looks like a typo but both verified correct on their respective model pages.

## Unverifiable / known limitations

- **gpt-5.5-pro effort values** — no official enumeration exists anywhere fetched (model page, reasoning guide, usage guide, OpenRouter). The `['medium','high','xhigh']` recommendation is an inference from documented siblings — the strongest available evidence, but flagged as not directly documented. If OpenAI later publishes the enum, re-verify.
- **gpt-5.4-pro long-context surcharge** — MP states prompts >272K input tokens bill at 2x input / 1.5x output. The flat `pricing` shape in `models.ts` cannot represent tiered pricing; cost estimates for very long pro prompts will be low. Pre-existing schema limitation, out of scope here.
- **gpt-5.5 release date 04-23 vs API availability 04-24** — announcement and snapshot say 2026-04-23; press coverage says API access opened 2026-04-24. Kept 2026-04-23 (snapshot wins).
- **Verbosity enum per non-flagship model** — `['low','medium','high']` is documented at the parameter level, not re-enumerated on each model page.
- **`nativeStructuredOutputs`** — only gpt-5.5/gpt-5.5-pro carry it though most listed models support structured outputs; flag is display-only (landing page), so under-reporting is cosmetic, not functional. Left as is.
