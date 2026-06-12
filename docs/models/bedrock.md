# Bedrock provider validation — `apps/sim/providers/models.ts`

- **Date:** 2026-06-11 (final exhaustive pass; re-verifies PR #4990)
- **Scope:** all 32 `bedrock/*` model entries
- **Method:** every fact below traced to a live source fetched today:
  - **AWS Pricing API** (authoritative for token prices): `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/us-east-1/index.json` (1.37 MB, Last-Modified 2026-06-11) and the `us-west-2` offer file. Prices are per 1K tokens in the offer; converted ×1000 to per-1M below. Claude 4.x, Cohere, and Mistral Large 24.11 have **no SKUs** in the Pricing API (marketplace-billed / absent).
  - **AWS model cards:** `docs.aws.amazon.com/bedrock/latest/userguide/model-card-<provider>-<model>.html` (authoritative for geo/global inference IDs, context window, max output, lifecycle, prompt caching).
  - **Lifecycle:** `docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html` (Legacy/EOL table).
  - **Anthropic:** `platform.claude.com/docs/en/about-claude/pricing` and `.../models/overview` (Claude prices, cache rates, max output, Bedrock geo premium).
  - **AWS what's-new** for the Nova Premier GA date and Nova 2 announcements.

---

## GEO-PROFILE TABLE (deliverable for `getBedrockInferenceProfileId`)

Source: each model card's Programmatic Access table ("Geo inference ID" / "Global inference ID" columns). `geo` = inference profile required/available (the bare ID is generally **not** invokable on-demand for these, except where noted); `bare` = card lists "Not supported" for both Geo and Global — must invoke with the plain model ID.

| model id suffix | verdict | profiles on card |
|---|---|---|
| anthropic.claude-opus-4-5-20251101-v1:0 | **geo** (REQUIRED) | `us.`, `eu.` + `global.` (no apac/au/jp) |
| anthropic.claude-sonnet-4-5-20250929-v1:0 | **geo** (REQUIRED) | `us.`, `eu.`, `au.`, `jp.` + `global.` (no `apac.`) |
| anthropic.claude-haiku-4-5-20251001-v1:0 | **geo** (REQUIRED in most regions) | `us.`, `eu.`, `au.`, `jp.` + `global.` (no `apac.`; in-region only us-east-1/eu-north-1/eu-west-1/ap-northeast-1/ap-southeast-4) |
| anthropic.claude-opus-4-1-20250805-v1:0 | **geo** (REQUIRED) | `us.` only; global NOT supported |
| amazon.nova-2-pro-v1:0 | **unknown** (no card; ID does not exist on Bedrock — real preview ID is `amazon.nova-2-pro-preview-20251202-v1:0`, served via geo/global profiles per cloudprice `apac.amazon.nova-2-pro-preview-…`) |
| amazon.nova-2-lite-v1:0 | **geo** (REQUIRED) | `us.`, `eu.`, `jp.` + `global.` (no `apac.`) |
| amazon.nova-premier-v1:0 | **geo** (REQUIRED) | `us.` only; global NOT supported |
| amazon.nova-pro-v1:0 | **geo** | `us.`, `eu.` (no apac/global; in-region exists in us-east-1 and a few others) |
| amazon.nova-lite-v1:0 | **geo** | `us.`, `eu.` (no apac/global) |
| amazon.nova-micro-v1:0 | **geo** | `us.`, `eu.` (no apac/global) |
| meta.llama4-maverick-17b-instruct-v1:0 | **geo** (REQUIRED) | `us.` only |
| meta.llama4-scout-17b-instruct-v1:0 | **geo** (REQUIRED) | `us.` only |
| meta.llama3-3-70b-instruct-v1:0 | **geo** | `us.` only |
| meta.llama3-2-90b-instruct-v1:0 | **geo** (REQUIRED) | `us.` only |
| meta.llama3-2-11b-instruct-v1:0 | **geo** (REQUIRED) | `us.` only |
| meta.llama3-2-3b-instruct-v1:0 | **geo** (REQUIRED) | `us.`, `eu.` |
| meta.llama3-2-1b-instruct-v1:0 | **geo** (REQUIRED) | `us.`, `eu.` |
| meta.llama3-1-405b-instruct-v1:0 | **geo** | `us.` only (in-region only us-west-2) |
| meta.llama3-1-70b-instruct-v1:0 | **geo** | `us.` only (in-region only us-west-2) |
| meta.llama3-1-8b-instruct-v1:0 | **geo** | `us.` only (in-region only us-west-2) |
| mistral.mistral-large-3-675b-instruct | **bare** | Geo: Not supported; Global: Not supported (in-region, 11 regions) |
| mistral.mistral-large-2411-v1:0 | **bare** (phantom — see below; the Mistral Large card covers only `mistral-large-2402-v1:0`, bare) |
| mistral.mistral-large-2407-v1:0 | **bare** (no card; on-demand SKUs exist in us-west-2; the 2402 card shows Geo/Global Not supported — same family, in-region only) |
| mistral.pixtral-large-2502-v1:0 | **geo** (REQUIRED) | `us.`, `eu.` |
| mistral.magistral-small-2509 | **bare** | Geo: Not supported; Global: Not supported |
| mistral.ministral-3-14b-instruct | **bare** | Geo: Not supported; Global: Not supported |
| mistral.ministral-3-8b-instruct | **bare** | Geo: Not supported; Global: Not supported |
| mistral.ministral-3-3b-instruct | **bare** | Geo: Not supported; Global: Not supported (card "Ministral 3B" confirms this exact ID) |
| mistral.mixtral-8x7b-instruct-v0:1 | **bare** | Geo: Not supported; Global: Not supported |
| amazon.titan-text-premier-v1:0 | **bare** | model card removed from docs; historically in-region only, never had inference profiles |
| cohere.command-r-v1:0 | **bare** | card: Geo Not supported; Global Not supported |
| cohere.command-r-plus-v1:0 | **bare** | card: Geo Not supported; Global Not supported |

Implications for `apps/sim/providers/bedrock/utils.ts` (`getBedrockInferenceProfileId`):

1. All `mistral.*` IDs **except** `mistral.pixtral-large-2502-v1:0`, all `cohere.*` IDs, and `amazon.titan-text-premier-v1:0` must be passed through **unprefixed**. Today the function prefixes everything → `ValidationException` for these 10 models.
2. The blanket `ap-*/me-* → apac` mapping is wrong for every model in this list: **no bedrock-provider model has an `apac.` profile**. Claude Sonnet/Haiku 4.5 use `au.`/`jp.` (or `global.`); Nova 2 Lite has `jp.`; everything else is `us.`/`eu.` only.
3. `eu.` is only valid for: claude opus/sonnet/haiku 4.5, nova-2-lite, nova pro/lite/micro, llama3-2-3b/1b, pixtral-large. For the rest (opus-4-1, nova-premier, all other llamas) only `us.` exists — an `eu-*` region request currently produces a nonexistent `eu.` profile ID.

---

## Per-model verification

Prices are USD per 1M tokens, **standard on-demand, us-east-1** (us-west-2 where us-east-1 has no SKU). "Pricing API" = the offer file above, fetched 2026-06-11.

### Anthropic (no Pricing API SKUs — verified against Anthropic pricing page; Bedrock bills Anthropic list prices)

| model | field | repo | verified | source | verdict |
|---|---|---|---|---|---|
| claude-opus-4-5 | input/output | 5 / 25 | 5 / 25 | Anthropic pricing | OK |
| | cachedInput | — | 0.50 (0.1× input; Bedrock card: caching Yes, min 4096 tok) | Anthropic pricing + card | **ADD** |
| | maxOutputTokens | 64000 | 64K | card + Anthropic overview | OK |
| | contextWindow | 200000 | 200K | card | OK |
| | releaseDate | 2025-11-24 | Nov 24 2025 | card | OK |
| claude-sonnet-4-5 | input/output | 3 / 15 | 3 / 15 | Anthropic pricing | OK |
| | cachedInput | — | 0.30 | Anthropic pricing + card (caching Yes) | **ADD** |
| | maxOutputTokens / ctx | 64000 / 200000 | 64K / 200K | card | OK |
| | releaseDate | 2025-09-29 | card says Sep 30 2025; Anthropic launch Sep 29 2025 | keep repo (matches upstream launch) |
| | recommended | — | provider default model | models.ts convention | **ADD `recommended: true`** |
| claude-haiku-4-5 | input/output | 1 / 5 | 1 / 5 | Anthropic pricing | OK |
| | cachedInput | — | 0.10 | Anthropic pricing + card (caching Yes) | **ADD** |
| | maxOutputTokens / ctx | 64000 / 200000 | 64K / 200K | card | OK |
| | releaseDate | 2025-10-15 | card says Oct 16 2025; Anthropic launch Oct 15 2025 | keep repo |
| | speedOptimized | — | "the fastest model with near-frontier intelligence" | Anthropic overview | **ADD `speedOptimized: true`** |
| claude-opus-4-1 | input/output | 15 / 75 | 15 / 75 | Anthropic pricing | OK |
| | cachedInput | — | 1.50 | Anthropic pricing + card (caching Yes, 5m TTL only) | **ADD** |
| | maxOutputTokens | 32768 | **32K = 32000** (card "32K"; Anthropic overview "32k tokens") | **FIX 32768 → 32000** (32768 would exceed the documented cap) |
| | ctx / releaseDate / lifecycle | 200000 / 2025-08-05 / active | 200K / Aug 05 2025 / Active on Bedrock (deprecated on first-party API, retire 2026-08-05 — Bedrock lifecycle independent) | OK |

**Geo premium (open question d):** Anthropic's pricing page states regional/multi-region endpoints carry a **10% premium over global** for Sonnet 4.5, Haiku 4.5, Opus 4.5 "and all future models" (earlier models keep existing pricing). Sim always builds geo profiles, so real spend on these three is 1.1× the table values. **Decision: keep base prices and document** — (a) the Pricing API exposes no Claude SKUs to anchor a geo-specific number, (b) repo convention is provider list price, (c) baking 1.1× would overbill if/when the provider routes `global.`. Revisit if Sim adds `global.` routing.

### Amazon Nova (Pricing API us-east-1)

| model | field | repo | verified | verdict |
|---|---|---|---|---|
| nova-2-pro | input/output | 1.0 / 4.0 | **1.375 / 11.0** (`USE1-Nova2.0Pro-text-input-tokens` 0.001375, `-text-output-tokens` 0.011; global cross-region 1.25/10.0) | **FIX**. Note: cloudprice lists 2.19/17.50 for an apac preview profile — AWS Pricing API wins |
| | identity | `amazon.nova-2-pro-v1:0` | no model card; not in catalog; real ID is `amazon.nova-2-pro-preview-20251202-v1:0` (preview, Nova Forge early access, per AWS re:Invent 2025 what's-new + cloudprice/getmaxim) | entry is a **phantom ID**; `deprecated: true` (PR #4990) keeps it hidden — acceptable; longer-term remove or migrate to the preview ID |
| nova-2-lite | input/output | 0.08 / 0.32 | **0.33 / 2.75** (`USE1-Nova2.0Lite-input-tokens` 0.00033, `-output-tokens` 0.00275) | **FIX** — resolves open question (a): repo was wrong AND the secondaries' 0.30/2.50 is the *global cross-region* price (`-cross-region-global` SKUs), not the geo/in-region price Sim pays |
| | cachedInput | — | **0.0825** (`-cache-read-input-token-count` 0.0000825; cache write $0) | **ADD** |
| | maxOutputTokens | — | 64K (card) | **ADD 64000** |
| | ctx / releaseDate / lifecycle | 1000000 / 2025-12-02 / active | 1M / Dec 02 2025 / Active; geo us/eu/jp + global | OK |
| nova-premier | input/output | 2.5 / 12.5 | 2.50 / 12.50 (`USE1-NovaPremier-*`) | OK (PR #4990 fix confirmed) |
| | cachedInput | — | 0.625 (`-cache-read` 0.000625) | **ADD** (model is Legacy but still billable until EOL 2026-09-14) |
| | deprecated | true | Legacy 2026-03-13, EOL 2026-09-14 (lifecycle page + card) | OK |
| | maxOutputTokens | — | 25K (card) | skip per instruction (deprecated); documented only |
| | releaseDate | 2025-04-30 | GA announced Apr 30 2025 (aws.amazon.com what's-new 2025/04 "Amazon Nova Premier… generally available"); card shows "Oct 31 2025" which conflicts with AWS's own GA announcement and the lifecycle history — treated as a card-metadata anomaly | **keep 2025-04-30** |
| nova-pro | input/output | 0.8 / 3.2 | 0.80 / 3.20 | OK (question b resolved) |
| | cachedInput | — | 0.20 | **ADD** |
| | maxOutputTokens | — | 5K (card) | **ADD 5120** (Nova "5K" cap; trackers/openrouter report 5,120) |
| | ctx | 300000 | 300K | OK; releaseDate repo 2024-12-03 (re:Invent announce) vs card Dec 05 2024 — keep repo, documented |
| nova-lite | input/output | 0.06 / 0.24 | 0.06 / 0.24 | OK |
| | cachedInput | — | 0.015 | **ADD** |
| | maxOutputTokens | — | 5K | **ADD 5120** |
| nova-micro | input/output | 0.035 / 0.14 | 0.035 / 0.14 | OK |
| | cachedInput | — | 0.00875 | **ADD** |
| | maxOutputTokens | — | 5K | **ADD 5120** |
| | speedOptimized | — | card: "Amazon's fastest text-only model, optimized for speed and low cost" | **ADD `speedOptimized: true`** |

### Meta (Pricing API; all cards report max output 4K for 3.x, 8K for Llama 4)

| model | field | repo | verified | verdict |
|---|---|---|---|---|
| llama4-maverick | input/output | 0.24 / 0.97 | 0.24 / 0.97 | OK |
| | maxOutputTokens | — | 8K (card) | **ADD 8192** |
| | ctx / date / lifecycle | 1M / 2025-04-05 / active | 1M / Apr 05 2025 / Active | OK |
| llama4-scout | input/output | 0.18 / 0.72 | **0.17 / 0.66** (`USE1-Llama4-Scout-17B-*` 0.00017 / 0.00066) | **FIX** |
| | maxOutputTokens | — | 8K | **ADD 8192** |
| | ctx | 10000000 | 10M (card) | OK (PR #4990 fix confirmed) |
| llama3-3-70b | input/output | 0.72 / 0.72 | 0.72 / 0.72 | OK |
| | lifecycle | active | **Active** (card; absent from Legacy table) — question (g) | OK |
| | maxOutputTokens | — | 4K | **ADD 4096** |
| llama3-2-90b | input/output | 2.0 / 2.0 | **0.72 / 0.72** (`USE1-Llama3-2-90B-*`) | **FIX** (deprecated but still billable until EOL 2026-07-07) |
| | deprecated | true | Legacy, EOL Jul 7 2026 | OK |
| llama3-2-11b | input/output | 0.16 / 0.16 | 0.16 / 0.16; Legacy EOL 2026-07-07 | OK |
| llama3-2-3b | input/output | 0.15 / 0.15 | 0.15 / 0.15; Legacy | OK |
| llama3-2-1b | input/output | 0.10 / 0.10 | 0.10 / 0.10; Legacy | OK |
| llama3-1-405b | input/output | 5.32 / 16.0 | **2.40 / 2.40** (`USW2-Llama3-1-405B-*` 0.0024; us-east-1 has only batch SKUs at 1.20) | **FIX** (deprecated, Legacy EOL 2026-07-07, but price was ~5× off) |
| llama3-1-70b | input/output | 2.65 / 3.5 | **0.72 / 0.72** (`USE1-Llama3-1-70B-*`; the 2.65 figure resembles no AWS SKU — latency-optimized variant is a separate SKU) | **FIX** |
| | lifecycle | active | **Active** (card) — question (g) | OK |
| | maxOutputTokens / releaseDate | — / — | 4K / Jul 23 2024 | **ADD 4096, 2024-07-23** |
| llama3-1-8b | input/output | 0.3 / 0.6 | **0.22 / 0.22** (`USE1-Llama3-1-8B-*`) | **FIX** |
| | lifecycle | active | **Active** (card) | OK |
| | maxOutputTokens / releaseDate | — / — | 4K / Jul 23 2024 | **ADD 4096, 2024-07-23** |

### Mistral AI (Pricing API + cards)

| model | field | repo | verified | verdict |
|---|---|---|---|---|
| mistral-large-3-675b | input/output | 0.5 / 1.5 | 0.50 / 1.50 (`USE1-Mistral-Large-3-675b-Instruct-*`) | OK (PR #4990 confirmed) |
| | ctx / maxOutput | 256000 / 32768 | 256K / 32K (card) | OK |
| | releaseDate | — | Dec 2 2025 (card) | **ADD 2025-12-02** |
| | caching | — | card: prompt caching **Yes** (bedrock-runtime), but no cache-read SKU in Pricing API → rate unpublishable | no `cachedInput` (documented) |
| mistral-large-2411 | input/output | 2.0 / 6.0 | **UNVERIFIABLE — model appears not to exist on Bedrock**: no model card (Mistral card index has only "Mistral Large" = 2402 and "Mistral Large 3"), no Pricing API SKU in us-east-1 or us-west-2, not in lifecycle table | keep price; entry is already `deprecated: true` (hidden); recommend follow-up removal |
| mistral-large-2407 | input/output | 4.0 / 12.0 | **2.00 / 6.00** (`USW2-MistralLarge2407-*` 0.002/0.006; us-west-2 only). The 4/12 figure belongs to *Mistral Large 2402* (`USE1-MistralLarge-*` = 0.004/0.012) — repo had the two swapped | **FIX** (deprecated but billable) |
| pixtral-large-2502 | input/output | 2.0 / 6.0 | 2.00 / 6.00 (`USE1-PixtralLarge2502-*`) | OK (question b resolved) |
| | ctx / maxOutput / lifecycle | 128000 / 16384 / active | 128K / 16K / Active | OK |
| magistral-small-2509 | input/output | 0.5 / 1.5 | 0.50 / 1.50 | OK |
| | ctx / maxOutput / lifecycle | 128000 / 40000 / active | 128K / 40K / Active (card launch "Sep 2025", no day — no releaseDate added) | OK |
| ministral-3-14b | input/output | 0.2 / 0.2 | 0.20 / 0.20 (`USE1-Ministral-3-14b-Instruct-*`) | OK |
| | maxOutput / releaseDate | 8192 / — | 8K / Dec 2 2025 | **ADD 2025-12-02** |
| | caching | — | card shows no prompt-caching row → unconfirmed | no `cachedInput` |
| ministral-3-8b | input/output | 0.1 / 0.1 | **0.15 / 0.15** (`USE1-Ministral-3-8b-Instruct-*` 0.00015) | **FIX**; **ADD releaseDate 2025-12-02** |
| ministral-3-3b | input/output | 0.04 / 0.04 | **0.10 / 0.10** (`USE1-Ministral-3-3b-Instruct-*` 0.0001) | **FIX**; **ADD releaseDate 2025-12-02** (card "Ministral 3B" confirms ID `mistral.ministral-3-3b-instruct`, 128K ctx, 8K out, Active) |
| mixtral-8x7b | input/output | 0.45 / 0.7 | 0.45 / 0.70 (`USE1-Mixtral8x7B-*`) | OK (question b resolved) |
| | ctx / lifecycle | 32000 / active | 32K / Active | OK |
| | maxOutputTokens | — | 4K (card) | **ADD 4096** |

### Amazon Titan / Cohere

| model | field | repo | verified | verdict |
|---|---|---|---|---|
| titan-text-premier | input/output | 0.5 / 1.5 | 0.50 / 1.50 (`USE1-TitanText-Premier-*`, attribute `titanModel: "Titan Text G1 Premier"`) | OK |
| | deprecated | true | model card **removed** from the model-cards index (only Titan embeddings/image cards remain); absent from the Legacy table (which excludes models already past EOL) | OK — keep deprecated |
| cohere command-r | input/output | 0.5 / 1.5 | not in Pricing API (marketplace-billed); matches long-standing AWS list price | UNVERIFIABLE via Pricing API — keep |
| | deprecated | true | Legacy 2026-02-19, EOL 2026-08-19 (lifecycle + card) | OK |
| cohere command-r-plus | input/output | 3.0 / 15.0 | not in Pricing API; matches long-standing AWS list price | UNVERIFIABLE — keep |
| | deprecated | true | Legacy 2026-02-19, EOL 2026-08-19 | OK |

---

## Changes made in this pass (fix list for models.ts — to be applied by the follow-up code change)

Pricing (all `updatedAt` → `2026-06-11`):

1. `bedrock/amazon.nova-2-pro-v1:0`: input 1.0 → 1.375, output 4.0 → 11.0 (Pricing API `USE1-Nova2.0Pro-text-*`)
2. `bedrock/amazon.nova-2-lite-v1:0`: input 0.08 → 0.33, output 0.32 → 2.75 (Pricing API `USE1-Nova2.0Lite-*`)
3. `bedrock/meta.llama4-scout-17b-instruct-v1:0`: input 0.18 → 0.17, output 0.72 → 0.66
4. `bedrock/meta.llama3-2-90b-instruct-v1:0`: 2.0/2.0 → 0.72/0.72
5. `bedrock/meta.llama3-1-405b-instruct-v1:0`: 5.32/16.0 → 2.40/2.40 (USW2 on-demand)
6. `bedrock/meta.llama3-1-70b-instruct-v1:0`: 2.65/3.5 → 0.72/0.72
7. `bedrock/meta.llama3-1-8b-instruct-v1:0`: 0.3/0.6 → 0.22/0.22
8. `bedrock/mistral.mistral-large-2407-v1:0`: 4.0/12.0 → 2.0/6.0 (USW2 `MistralLarge2407`)
9. `bedrock/mistral.ministral-3-8b-instruct`: 0.1/0.1 → 0.15/0.15
10. `bedrock/mistral.ministral-3-3b-instruct`: 0.04/0.04 → 0.10/0.10

cachedInput additions (cache-read rate):

11. claude-opus-4-5: 0.5; claude-sonnet-4-5: 0.3; claude-haiku-4-5: 0.1; claude-opus-4-1: 1.5 (Anthropic pricing 0.1× input; Bedrock cards confirm caching)
12. nova-2-lite: 0.0825; nova-premier: 0.625; nova-pro: 0.2; nova-lite: 0.015; nova-micro: 0.00875 (Pricing API cache-read SKUs; Nova cache writes are $0)

maxOutputTokens:

13. claude-opus-4-1: 32768 → 32000 (Anthropic overview "32k"; Bedrock card "32K")
14. nova-2-lite: add 64000; nova-pro/lite/micro: add 5120 each
15. llama4-maverick/scout: add 8192 each; llama3-3-70b, llama3-1-70b, llama3-1-8b: add 4096 each; mixtral-8x7b: add 4096

Flags / metadata:

16. claude-sonnet-4-5: add `recommended: true` (bedrock default model; matches other providers' convention)
17. claude-haiku-4-5 and nova-micro: add `speedOptimized: true` (Anthropic "fastest model"; card "Amazon's fastest text-only model"). Ruled **against** `speedOptimized` on nova-2-lite — its card positions it as cost-efficient multimodal, not the speed tier.
18. releaseDate additions: mistral-large-3 `2025-12-02`; ministral-3-14b/8b/3b `2025-12-02`; llama3-1-70b/8b `2024-07-23`

## Deliberately not changed

- **Claude 4.5-gen geo premium (q. d):** kept base list prices; Sim's geo-profile routing actually bills 1.1× for opus/sonnet/haiku 4.5 per Anthropic's pricing page. Documented here rather than baked in (no AWS SKU to anchor; would overstate global-endpoint cost; consistent with list-price convention).
- **Release-date nits (q. h):** sonnet-4-5 `2025-09-29` and haiku-4-5 `2025-10-15` kept (Anthropic launch dates; Bedrock cards say +1 day). nova pro/lite/micro `2024-12-03` kept (re:Invent announcement; cards say Dec 05). nova-premier `2025-04-30` kept — AWS what's-new confirms GA Apr 30 2025; the card's "Oct 31 2025" contradicts AWS's own announcement.
- **Deprecated models' maxOutputTokens** (nova-premier 25K, llama3-2 4K, command-r/r+ 4K, mistral-large-2407 4K): per instruction, not added.
- **All deprecated flags from PR #4990 re-verified correct:** nova-premier, llama3-2 ×4, llama3-1-405b, command-r/r+ (Legacy with EOL dates on the lifecycle page), titan-text-premier (card removed from catalog), mistral-large-2411/2407 (absent from catalog). llama3-1-70b/8b and llama3-3-70b confirmed **Active** — correctly not deprecated.
- **mistral-large-3 / magistral / ministral-14b `cachedInput`:** Large 3 card says caching is supported but no cache-read SKU exists in the Pricing API; ministral-14b card shows no caching row. No invented numbers.
- **`bedrock/amazon.nova-2-pro-v1:0` and `bedrock/mistral.mistral-large-2411-v1:0` entries kept** (both `deprecated: true`, hidden): the former's real Bedrock ID is `amazon.nova-2-pro-preview-20251202-v1:0` (preview), the latter appears to have never shipped on Bedrock. Recommend a follow-up PR to remove/rename — out of scope for a validation pass.

## Unverifiable

- **cohere.command-r-v1:0 / command-r-plus-v1:0 prices** (0.5/1.5, 3/15): absent from the Pricing API (marketplace-billed); match the long-standing published AWS rates; models are Legacy. Kept as-is.
- **mistral-large-2411 price** (2/6): no SKU, no card; phantom entry (see above).
- **nova-2-pro geo-profile support**: no card; preview ID served via profiles per third-party trackers only.
- **Mistral Large 3 cache-read rate**: caching supported per card; rate unpublished.
