# Vertex AI provider — model validation (`models.ts` lines ~1487–1685)

- **Date:** 2026-06-11 (final exhaustive pass, re-verifying PR #4990 changes)
- **Method:** Live WebFetch of Google pricing/model/changelog pages; Google Cloud doc pages render nav-only to fetchers, so Vertex-specific specs were verified via Context7 MCP (`/websites/cloud_google_vertex-ai`, `/websites/cloud_google_gemini-enterprise-agent-platform`) and WebSearch fallback, per the validate-model skill. Two-source rule applied to pricing (Vertex pricing page + Gemini API pricing page / OpenRouter / CloudPrice).
- **Primary sources:**
  - https://cloud.google.com/vertex-ai/generative-ai/pricing (rendered fully — all pricing below)
  - https://ai.google.dev/gemini-api/docs/pricing (cross-check; global-endpoint prices identical for 2.5/3.x)
  - https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash, …/gemini-3.1-pro-preview, …/gemini-3.1-flash-lite, …/gemini-3-flash-preview, …/gemini-2.5-pro (token limits)
  - https://ai.google.dev/gemini-api/docs/thinking (thinking levels/defaults)
  - https://ai.google.dev/gemini-api/docs/changelog (lifecycle dates)
  - https://deepmind.google/models/model-cards/gemini-3-5-flash/ (3.5 Flash card)
  - Vertex docs via Context7: `…/models/gemini/2-5-pro` ("maximum output token limit of 65,535"), `…/migrate/migrate-palm-to-gemini`, `…/learn/model-versioning`, `…/learn/locations`
  - https://blog.google/technology/developers/deep-research-agent-gemini-api/ (2025-12-11), https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-flash-lite/ (2026-03-03)
- **Provider implementation:** `apps/sim/providers/vertex/index.ts` contains no capability handling itself — it delegates to `executeGeminiRequest` in `apps/sim/providers/gemini/core.ts`, which consumes `request.thinkingLevel` (core.ts:955–961, sent only when user explicitly selects a level) and `request.maxTokens` (core.ts:934). `thinking`, `temperature`, and `maxOutputTokens` flags are live; the global `maxOutputTokens` fallback is 4096 (models.ts:865), which is why PR #4990 added explicit caps.

---

## Per-model validation

### vertex/gemini-3.5-flash

| Field | Repo | Live docs | Source | Verdict |
|---|---|---|---|---|
| id | `gemini-3.5-flash` (GA 2026-05-19) | `gemini-3.5-flash` | ai.google.dev changelog ("Released `gemini-3.5-flash`… GA" 2026-05-19) | ✓ |
| input | 1.5 | $1.50 (global) | Vertex pricing + Gemini API pricing + OpenRouter | ✓ (3 sources) |
| cachedInput | 0.15 | $0.15 | Vertex pricing + Gemini API pricing | ✓ |
| output | 9.0 | $9.00 | Vertex pricing + Gemini API pricing + OpenRouter | ✓ |
| contextWindow | 1048576 | 1,048,576 | ai.google.dev/gemini-api/docs/models/gemini-3.5-flash; DeepMind card "1M" | ✓ |
| maxOutputTokens | 65536 | 65,536 | ai.google.dev model page ("64K" on DeepMind card) | ✓ |
| thinking | minimal/low/medium/high, default medium | minimal, low, medium, high; default medium | ai.google.dev/gemini-api/docs/thinking; OpenRouter ("defaults to medium thinking effort") | ✓ |
| releaseDate | 2026-05-19 | "Published 19 May 2026" | DeepMind model card + changelog | ✓ |
| recommended | absent | — | google provider entry has `recommended: true` on the same model | 🔵 add (see fixes) |

Note: Vertex introduces **non-global endpoint pricing (+10%: $1.65 / $9.90 / $0.165) effective 2026-07-01**; our entries model global pricing. See operational caveats.

### vertex/gemini-3.1-pro-preview

| Field | Repo | Live docs | Source | Verdict |
|---|---|---|---|---|
| id | `gemini-3.1-pro-preview` | `gemini-3.1-pro-preview` | ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview | ✓ |
| input | 2.0 | $2 (≤200k); $4 (>200k) | Vertex pricing + Gemini API pricing | ✓ (≤200k tier; >200k tier not modeled — see caveats) |
| cachedInput | 0.2 | $0.20 (≤200k); $0.40 (>200k) | same | ✓ |
| output | 12.0 | $12 (≤200k input); $18 (>200k) | same | ✓ |
| contextWindow | 1048576 | 1,048,576 | ai.google.dev model page; Vertex release notes "1M token context window" | ✓ |
| maxOutputTokens | 65536 | 65,536 | ai.google.dev model page | ✓ |
| thinking | low/medium/high, default high | low, medium, high; default high (Dynamic); **minimal not supported** | ai.google.dev/gemini-api/docs/thinking | ✓ (PR #4990 drop of 'minimal' confirmed correct) |
| releaseDate | 2026-02-19 | 2026-02-19 | blog.google gemini-3-1-pro; github.blog changelog 2026-02-19 | ✓ |

**Operational caveat (open question f):** Google documents `gemini-3.1-pro-preview` as **global-endpoint-only on Vertex AI** (Vertex `learn/locations` lists it under global-endpoint models; third-party migration guides state regional endpoints don't serve it). `apps/sim/providers/vertex/index.ts:34` resolves location as `request.vertexLocation || env.VERTEX_LOCATION || 'us-central1'` — with the default `us-central1`, requests to this model will fail with model-not-found. Users must set `vertexLocation` / `VERTEX_LOCATION` to `global`. No code change made (per instructions); documented here.

### vertex/gemini-3.1-flash-lite

| Field | Repo | Live docs | Source | Verdict |
|---|---|---|---|---|
| id | `gemini-3.1-flash-lite` (renamed from `-preview` in PR #4990) | stable id `gemini-3.1-flash-lite`; preview id shut down on Gemini API 2026-05-25; Vertex preview-alias discontinuation 2026-07-09 | ai.google.dev changelog ("Released `gemini-3.1-flash-lite`… GA" 2026-05-07; preview "shut down" 2026-05-25); cloud.google.com blog "Gemini 3.1 Flash-Lite is now generally available" | ✓ rename confirmed correct |
| input | 0.25 | $0.25 (global, text) | Vertex pricing + Gemini API pricing | ✓ |
| cachedInput | 0.025 | $0.025 | same | ✓ |
| output | 1.5 | $1.50 | same + blog.google launch post | ✓ |
| contextWindow | 1048576 | 1,048,576 | ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite | ✓ |
| maxOutputTokens | 65536 | 65,536 | same | ✓ |
| thinking levels | minimal/low/medium/high | minimal "Supported (Default)", low, medium, high | ai.google.dev/gemini-api/docs/thinking (3.1 Flash-Lite row; the "Not supported" row is 3.1 **Pro**) | ✓ — orchestrator re-fetched the thinking doc and corrected this report's initial misreading |
| thinking default | 'minimal' | minimal ("Supported (Default)") | same | ✓ |
| releaseDate | 2026-05-07 | stable GA 2026-05-07 (preview launch was 2026-03-03) | ai.google.dev changelog | ✓ changed this pass to the GA date |
| speedOptimized | absent | "our most cost-effective model yet", lowest-latency tier | blog.google launch post | 🔵 add (see fixes) |

**Open question (c) resolved:** the preview→stable rename is right (preview already shut down on the Gemini API 2026-05-25; Vertex alias discontinues 2026-07-09). This report initially claimed `minimal` is rejected on 3.1 Flash-Lite — that was a misreading of the thinking-levels table (the "Not supported" cell belongs to 3.1 **Pro**). The orchestrator re-fetched ai.google.dev/gemini-api/docs/thinking, which states for Gemini 3.1 Flash-Lite: minimal "Supported (Default)", plus low/medium/high. The repo's `levels: ['minimal','low','medium','high'], default: 'minimal'` is correct and was left unchanged.

### vertex/gemini-3-pro-preview (deprecated)

| Field | Repo | Live docs | Source | Verdict |
|---|---|---|---|---|
| deprecated | true | Gemini API shut down 2026-03-09 (`gemini-3-pro-preview` now aliases `gemini-3.1-pro-preview`); Vertex discontinuation 2026-03-26 | ai.google.dev changelog; Vertex deprecations (via third-party migration guides citing Google's table) | ✓ deprecated:true confirmed correct |
| pricing 2.0/0.2/12.0 | — | current pricing page no longer lists text Gemini 3 Pro (only "Gemini 3 Pro Image") | cloud.google.com/vertex-ai/generative-ai/pricing | ⚠️ historical values, unverifiable from current page; acceptable on a deprecated entry |
| contextWindow | 1000000 | launch materials said "1M token context window" | Vertex release notes | ⚠️ 1,000,000 vs sibling models' 1,048,576; left as-is (deprecated) |
| thinking | low/medium/high, default high | consistent with 3.x Pro line (no minimal) | ai.google.dev/gemini-api/docs/thinking (3.1-pro row) | ✓ |
| releaseDate | 2025-11-18 | 2025-11-18 | blog.google gemini-3; github.blog 2025-11-18; axios 2025-11-18 | ✓ |

Note: since the id now auto-redirects to 3.1 Pro on Google's side, calls may silently serve 3.1 Pro; `deprecated: true` steering users away is the right call.

### vertex/gemini-3-flash-preview

| Field | Repo | Live docs | Source | Verdict |
|---|---|---|---|---|
| id | `gemini-3-flash-preview` | `gemini-3-flash-preview` | ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview | ✓ |
| input / cachedInput / output | 0.5 / 0.05 / 3.0 | $0.50 / $0.05 / $3.00 | Vertex pricing + Gemini API pricing + TechCrunch | ✓ |
| contextWindow | 1048576 (PR #4990 change) | 1,048,576 | ai.google.dev model page | ✓ change confirmed |
| maxOutputTokens | 65536 | 65,536 | same | ✓ |
| thinking | minimal/low/medium/high, default high | minimal, low, medium, high; default high (Dynamic) | ai.google.dev/gemini-api/docs/thinking | ✓ |
| releaseDate | 2025-12-17 | 2025-12-17 | techcrunch.com 2025/12/17; 9to5google 2025/12/17; blog.google | ✓ |

### vertex/gemini-2.5-pro

| Field | Repo | Live docs | Source | Verdict |
|---|---|---|---|---|
| input | 1.25 | $1.25 (≤200k); $2.50 (>200k) | Vertex pricing + Gemini API pricing | ✓ (≤200k tier) |
| cachedInput | 0.125 | Vertex page displays "$0.13" (rounded); Gemini API exact "$0.125" | both pricing pages | ✓ (0.125 is exact value) |
| output | 10.0 | $10 (≤200k); $15 (>200k) | same | ✓ |
| contextWindow | 1048576 | 1,048,576 | Vertex `models/gemini/2-5-pro` (via Context7) + ai.google.dev | ✓ |
| maxOutputTokens | **65536** | **Vertex: 65,535** ("maximum output token limit of 65,535"); Gemini API page: 65,536 | docs.cloud.google.com/…/models/gemini/2-5-pro (via Context7); ai.google.dev/gemini-api/docs/models/gemini-2.5-pro | ✗ 🟡 — platforms disagree; this is the **Vertex** entry, so Vertex's 65,535 wins |
| releaseDate | 2025-03-25 | 2.5 Pro Experimental announced 2025-03-25 | blog.google gemini-model-thinking-updates-march-2025; siliconangle 2025/03/25 | ✓ |
| deprecated | absent | retirement on Vertex extended to **2026-10-16** | Vertex release notes (via gcpstudyhub summary of release-notes) | ✓ correctly NOT deprecated today — see (d) below |

### vertex/gemini-2.5-flash

| Field | Repo | Live docs | Source | Verdict |
|---|---|---|---|---|
| input / cachedInput / output | 0.3 / 0.03 / 2.5 | $0.30 / $0.03 / $2.50 | Vertex pricing + Gemini API pricing | ✓ |
| contextWindow | 1048576 | 1,048,576 | Vertex `models/gemini/2-5-flash` (via Context7) | ✓ |
| maxOutputTokens | **65536** | **Vertex: 65,535** ("default output token limit of 65,535") | docs.cloud.google.com/…/models/gemini/2-5-flash (via Context7); also migrate-palm-to-gemini doc ("2.5 Pro and 2.5 Flash… output context length of 65,535") | ✗ 🟡 |
| releaseDate | 2025-05-20 | preview launched 2025-04-17 on Gemini API; I/O announcement 2025-05-20/21; Vertex GA June 2025 | ai.google.dev changelog; Google I/O coverage | ⚠️ date is the I/O announcement; preview predates it. Left as-is (convention ambiguity, not a factual error) |
| deprecated | absent | retires 2026-10-16 | as above | ✓ not deprecated today |

### vertex/gemini-2.5-flash-lite

| Field | Repo | Live docs | Source | Verdict |
|---|---|---|---|---|
| input / cachedInput / output | 0.1 / 0.01 / 0.4 | $0.10 / $0.01 / $0.40 | Vertex pricing + Gemini API pricing | ✓ |
| contextWindow | 1048576 | 1,048,576 | Vertex `models/gemini/2-5-flash-lite` | ✓ |
| maxOutputTokens | **65536** | **65,535** | Vertex 2-5-flash-lite doc / Oracle OCI mirror of Google spec (websearch confirmation: "maximum output for Gemini 2.5 Flash-Lite is 65,535 tokens") | ✗ 🟡 |
| releaseDate | 2025-06-17 | 2.5 family GA + Flash-Lite preview announced 2025-06-17 | cloud.google.com blog "Gemini 2.5 Updates: Flash/Pro GA, SFT, Flash-Lite on Vertex AI" | ✓ |
| speedOptimized | absent | smallest/fastest 2.5 tier | google provider entry has `speedOptimized: true` (models.ts:1436) | 🔵 add (see fixes) |
| deprecated | absent | retires 2026-10-16 | as above | ✓ not deprecated today |

### vertex/gemini-2.0-flash (deprecated)

| Field | Repo | Live docs | Source | Verdict |
|---|---|---|---|---|
| deprecated | true | discontinued on Vertex **2026-06-01** (model serving + Provisioned Throughput) | github.com/firebase/extensions/issues/2607; Vertex model-versioning doc ("as of March 6, 2026 … only available for existing customers") | ✓ PR #4990 change confirmed |
| input | **0.1** | **$0.15** (Vertex token-based row, text) | cloud.google.com/vertex-ai/generative-ai/pricing | ✗ 🟡 repo carries Gemini API pricing ($0.10), not Vertex's |
| output | **0.4** | **$0.60** | same | ✗ 🟡 |
| cachedInput | 0.025 | not listed on Vertex pricing page (that's the Gemini API cache price) | same | ❓ UNVERIFIED on Vertex |
| maxOutputTokens | absent (falls back 4096) | 8,192 ("output context length of 8,192 tokens by default") | Vertex migrate-palm-to-gemini doc | 🔵 google entry has 8192; add for parity (low priority, discontinued) |
| contextWindow | 1048576 | 1,048,576 | same doc | ✓ |
| releaseDate | 2025-02-05 | GA on Vertex 2025-02-05 | blog.google gemini-model-updates-february-2025; developers.googleblog.com | ✓ |

### vertex/gemini-2.0-flash-lite (deprecated)

| Field | Repo | Live docs | Source | Verdict |
|---|---|---|---|---|
| deprecated | true | discontinued on Vertex 2026-06-01 | same sources as 2.0-flash | ✓ |
| input / output | 0.075 / 0.3 | $0.075 / $0.30 | Vertex pricing page | ✓ |
| cachedInput | omitted | none listed | same | ✓ correctly omitted |
| maxOutputTokens | absent | 8,192 default | Vertex migrate doc | 🔵 parity suggestion (low priority) |
| releaseDate | 2025-02-25 | preview 2025-02-05; exact 2025-02-25 GA date not found in fetched pages | _attempted: blog.google, Vertex release notes_ | ❓ UNVERIFIED (plausible — GA followed preview by ~3 weeks; deprecated, left as-is) |

### vertex/deep-research-pro-preview-12-2025

| Field | Repo | Live docs | Source | Verdict |
|---|---|---|---|---|
| id | `deep-research-pro-preview-12-2025` | Vertex pricing page has a "Gemini Deep Research Agent" row but no id; id appears on third-party Vertex trackers (CloudPrice `vertex_ai/deep-research-pro-preview-12-2025`); Gemini API changelog confirms Deep Research Agent preview launch 2025-12-11 but its docs now list `deep-research-preview-04-2026` / `deep-research-max-preview-04-2026` | cloud.google.com pricing; cloudprice.net; ai.google.dev/gemini-api/docs/deep-research + changelog | ⚠️ id verified only via secondary sources; **no announced shutdown of the 12-2025 id** — but Google has shipped 04-2026 successors on the Gemini API (watch item) |
| input | 2.0 | $2 | Vertex pricing page "Gemini Deep Research Agent" + CloudPrice | ✓ (open question a: pricing confirmed) |
| cachedInput | 0.2 | $0.20 | Vertex pricing page (CloudPrice omits cached) | ✓ |
| output | 12.0 | $12 | Vertex pricing page + CloudPrice | ✓ (PR #4990 output 12.0 confirmed) |
| contextWindow | 1048576 | **conflict**: CloudPrice says "66K tokens" context / "33K tokens" max output; underlying model is Gemini 3 Pro (1M ctx); no Google doc states the agent's window; launch blog only says it "handles large context gracefully" | cloudprice.net/models/vertex_ai/deep-research-pro-preview-12-2025; blog.google deep-research post; ai.google.dev/gemini-api/docs/deep-research (lists no token limits for any version) | ❓ UNVERIFIED — conflict NOT resolvable from Google docs (they publish no limits for the agent). 1048576 is an inference from the Gemini 3 Pro core; CloudPrice's 66K/33K (≈65,536/32,768) may reflect the agent's actual per-task envelope |
| maxOutputTokens | 65536 | no Google figure; CloudPrice says 33K | same | ❓ UNVERIFIED |
| capabilities deepResearch / memory:false | true / false | it is a managed autonomous research agent; multi-turn memory not offered in preview | blog.google + ai.google.dev/gemini-api/docs/deep-research | ✓ reasonable |
| releaseDate | 2025-12-11 | "Published December 11, 2025"; changelog: "Launched the Gemini Deep Research Agent in preview" 2025-12-11 | blog.google deep-research-agent-gemini-api; ai.google.dev changelog | ✓ |

---

## Changes made in this pass (PR #4990) — re-verification verdicts

| PR #4990 change | Verdict |
|---|---|
| Rename `vertex/gemini-3.1-flash-lite-preview` → `vertex/gemini-3.1-flash-lite` | ✓ correct — stable id GA 2026-05-07; preview shut down on Gemini API 2026-05-25; Vertex alias discontinues 2026-07-09 |
| Drop `'minimal'` from 3.1-pro-preview thinking.levels | ✓ correct — thinking docs: minimal "Not supported" on 3.1 Pro |
| `deprecated: true` on gemini-3-pro-preview | ✓ correct — shut down (Gemini API 2026-03-09; Vertex 2026-03-26) |
| `deprecated: true` on both 2.0 models | ✓ correct — discontinued 2026-06-01 |
| deep-research output → 12.0, cachedInput 0.2 | ✓ correct — Vertex pricing page row |
| deep-research ctx 1048576 + maxOutputTokens 65536 | ❓ remains unverifiable; CloudPrice conflict (66K/33K) unresolved — Google publishes no limits for the agent |
| maxOutputTokens 65536 on 3.5-flash / 3.1-pro / 3.1-flash-lite / 3-flash | ✓ correct — all four documented at 65,536 on their Gemini API model pages |
| maxOutputTokens 65536 on 2.5-pro / 2.5-flash / 2.5-flash-lite | ✗ off-by-one for Vertex — Vertex docs say **65,535** (Gemini API pages say 65,536; platforms genuinely disagree; Vertex entry should carry the Vertex value) |
| gemini-3-flash-preview ctx → 1048576 | ✓ correct |
| updatedAt bumps to 2026-06-11 | ✓ all pricing values verified current today |

## Recommended fixes (final disposition)

Rejected by orchestrator re-verification (not applied):
1. ~~`vertex/gemini-3.1-flash-lite` thinking.levels / default change~~ — the thinking doc confirms minimal IS supported and is the default on 3.1 Flash-Lite; the report's initial reading was wrong. No change made (google entry likewise untouched).

Applied (warning — platform-correct values):
3. `vertex/gemini-2.5-pro`: `maxOutputTokens` 65536 → 65535 (Vertex model doc)
4. `vertex/gemini-2.5-flash`: `maxOutputTokens` 65536 → 65535 (Vertex model doc)
5. `vertex/gemini-2.5-flash-lite`: `maxOutputTokens` 65536 → 65535 (Vertex model doc)
6. `vertex/gemini-2.0-flash`: `input` 0.1 → 0.15, `output` 0.4 → 0.6 (Vertex pricing page; repo carries Gemini API prices). `cachedInput: 0.025` is unverified on Vertex — consider removing. Low urgency (model discontinued).

Applied (suggestions):
7. `vertex/gemini-3.5-flash`: add `recommended: true` — parity with the google entry; vertex provider currently has no recommended model
8. `vertex/gemini-2.5-flash-lite`: add `speedOptimized: true` — parity with google entry (models.ts:1436)
9. `vertex/gemini-3.1-flash-lite`: add `speedOptimized: true` — "most cost-effective model yet" / lowest-latency tier (blog.google); apply to the google entry too for consistency
10. (optional) both vertex 2.0 entries: add `maxOutputTokens: 8192` for parity with google entries (Vertex docs: 8,192 default) — cosmetic, models discontinued

Also applied: `releaseDate` 2026-03-03 → 2026-05-07 on both the vertex and google `gemini-3.1-flash-lite` entries (GA date per the Gemini API changelog). Item 10 (maxOutputTokens on discontinued 2.0 entries) was skipped as cosmetic; `cachedInput` on vertex/gemini-2.0-flash was kept (Gemini API documented the rate; no Vertex contradiction found).

## Deliberately not changed

- **2.5 Pro / Flash / Flash-Lite not marked deprecated (open question d):** Vertex retirement is 2026-10-16 (extended from June 2026; Google says the final date will be confirmed with ≥6 months notice once Gemini 3 is GA). They are fully supported today; `deprecated: true` would prematurely hide working models. Recommendation: revisit ~2026-09 (calendar item), keep undeprecated now. Note `defaultModel: 'vertex/gemini-2.5-pro'` (models.ts:1491) will need a new default before retirement — consider moving to `vertex/gemini-3.5-flash` when `recommended` is added.
- **>200k-token pricing tiers (3.1-pro, 2.5-pro)** are not modeled — `pricing` is a flat structure; entries carry the ≤200k tier. Pre-existing, consistent with the google provider.
- **Non-global endpoint surcharge (effective 2026-07-01):** Vertex adds +10% pricing for non-global endpoints on 3.x models ($1.65/$9.90 for 3.5-flash, etc.). Our default location is `us-central1` (non-global), so billed cost may exceed modeled cost starting July 1. Entries keep global pricing (the canonical published rate); flagged for ops awareness.
- **`vertex/gemini-3-pro-preview` pricing/ctx left as historical** — model discontinued and absent from the current pricing page; `deprecated: true` is the user-facing protection.
- **releaseDate conventions:** 2.5-flash 2025-05-20 (I/O) kept despite an earlier 2025-04-17 Gemini-API preview; 3.1-flash-lite 2026-03-03 (preview announcement) kept despite 2026-05-07 stable GA. Both match the repo's "first public launch announcement" convention.
- **deep-research id not migrated** to the newer `deep-research-preview-04-2026` family — no announced shutdown of `deep-research-pro-preview-12-2025`, and the Vertex pricing row still matches it. Watch item for the next pass.

## Unverifiable

| Item | Attempted sources | Notes |
|---|---|---|
| `vertex/deep-research-pro-preview-12-2025` `contextWindow: 1048576` and `maxOutputTokens: 65536` | cloud.google.com pricing (no limits), ai.google.dev/gemini-api/docs/deep-research (lists only 04-2026 versions, no limits), blog.google launch post (no numbers), cloudprice.net (claims 66K ctx / 33K out) | Conflict NOT resolved: Google publishes no token limits for the agent. CloudPrice's 66K/33K (~65,536/32,768) is the only concrete figure and contradicts the repo's 1M. Current values are an inference from the Gemini 3 Pro core. Ask Google docs or test live before changing. |
| Vertex-side model id for the Deep Research Agent | Vertex pricing page (row name only), Vertex docs (nav-only render), Context7 | Only third-party trackers tie `deep-research-pro-preview-12-2025` to Vertex. |
| `vertex/gemini-2.0-flash` `cachedInput: 0.025` | Vertex pricing page (no cached row for 2.0) | $0.025 is the Gemini API cache price. Discontinued model; consider dropping the field. |
| `vertex/gemini-2.0-flash-lite` `releaseDate: 2025-02-25` | blog.google Feb 2025 post (preview 2025-02-05), Vertex release notes (nav-only) | Exact GA date not found this session; plausible, left as-is. |
| Vertex 3-pro-preview discontinuation date 2026-03-26 (exact) | Vertex deprecations page (nav-only), third-party migration guides | Gemini API shutdown 2026-03-09 is confirmed by the changelog; the Vertex-specific 03-26 date comes from secondary sources citing Google's deprecations table. Either way `deprecated: true` is correct. |
