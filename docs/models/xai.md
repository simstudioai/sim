# xAI Provider Validation — models.ts

- **Date:** 2026-06-11
- **Scope:** `xai` provider block in `apps/sim/providers/models.ts` (~lines 1752–1956), 13 models + provider config. Final re-verification after PR #4990 (deprecation flags, grok-4.20 repricing $2/$6 → $1.25/$2.50 and 2M → 1M, defaultModel → grok-4.3).
- **Method:** Live WebFetch of xAI docs (primary source, wins all conflicts); OpenRouter as secondary pricing source; WebSearch for release-date pinning; `rg` audit of `apps/sim/providers/xai/` for parameter wiring.
- **Sources:**
  - https://docs.x.ai/developers/models (model listing + pricing)
  - https://docs.x.ai/developers/models/grok-4.3, .../grok-4.20-0309-reasoning, .../grok-4.20-0309-non-reasoning, .../grok-4.20-multi-agent-0309, .../grok-build-0.1, .../grok-3, .../grok-3-fast, .../grok-4 (per-model pages)
  - https://docs.x.ai/developers/migration/may-15-retirement (retirement/redirect table)
  - https://docs.x.ai/developers/rest-api-reference/inference/chat (parameter ranges)
  - https://docs.x.ai/developers/model-capabilities/text/reasoning (reasoning_effort semantics)
  - https://openrouter.ai/x-ai/grok-4.3, https://openrouter.ai/x-ai/grok-4.20 (secondary)

## Provider config

| Field | Repo value | Source | Verdict |
|---|---|---|---|
| `defaultModel` | `grok-4.3` | docs.x.ai/developers/models — grok-4.3 is the current flagship ("most intelligent and fastest"); all retired slugs redirect to it | CORRECT (PR #4990 change re-verified) |
| `modelPatterns` | `/^grok/` | All current model ids start with `grok` | CORRECT |

## Active models

### grok-4.3

| Field | Repo value | Source value | Source | Verdict |
|---|---|---|---|---|
| input | 1.25 | $1.25 / 1M | docs.x.ai/developers/models/grok-4.3; OpenRouter agrees ($1.25) | CORRECT |
| cachedInput | 0.2 | $0.20 / 1M | docs.x.ai/developers/models/grok-4.3 | CORRECT |
| output | 2.5 | $2.50 / 1M | docs.x.ai/developers/models/grok-4.3; OpenRouter agrees ($2.50) | CORRECT |
| contextWindow | 1000000 | 1,000,000 tokens | docs.x.ai per-model page; OpenRouter agrees (1M, "no output token limit") | CORRECT |
| releaseDate | 2026-04-30 | April 30, 2026 | OpenRouter created date; consistent with xAI announcement timeline | CORRECT |
| temperature.max | 2 (fixed this pass, was 1) | 0–2 | docs.x.ai chat REST reference: "between 0 and 2" | ✓ after fix |
| recommended | true | flagship model | docs.x.ai | CORRECT |

Caveat: OpenRouter notes grok-4.3 requests exceeding 200k total tokens bill at a higher tier. xAI's own pricing tables show flat $1.25/$2.50; Sim's pricing model is flat, so the base tier is recorded. No change.

### grok-4.20-0309-reasoning / grok-4.20-0309-non-reasoning / grok-4.20-multi-agent-0309

All three per-model pages were fetched individually; all three show identical numbers (multi-agent is NOT priced differently):

| Field | Repo value | Source value | Source | Verdict |
|---|---|---|---|---|
| input | 1.25 | $1.25 / 1M | all three per-model pages | CORRECT (PR #4990 reprice re-verified) |
| cachedInput | 0.2 | $0.20 / 1M | all three per-model pages | CORRECT |
| output | 2.5 | $2.50 / 1M | all three per-model pages | CORRECT |
| contextWindow | 1000000 | 1,000,000 tokens | all three per-model pages | CORRECT — see conflict note |
| releaseDate | 2026-03-10 | API availability March 10, 2026 | WebSearch (xAI API made Grok 4.20 + multi-agent available 2026-03-10; `0309` slug = March 9 snapshot) | CORRECT (secondary-source verified) |
| temperature.max | 2 (fixed this pass, was 1) | 0–2 | docs.x.ai chat REST reference | ✓ after fix |

**1M vs 2M conflict resolved:** OpenRouter (x-ai/grok-4.20) lists 2M context; xAI's three per-model pages each state "Context window: 1,000,000 tokens". Press coverage attributes the larger window to "agent modes" (consumer-side), not the API. xAI docs win → **1M confirmed, keep**. (OpenRouter's created date of 2026-03-31 is its listing date, not the API release.)

## Deprecated models (9 entries)

Retirement source: docs.x.ai/developers/migration/may-15-retirement — "After May 15, 2026 at 12:00 PM PT, requests to the retired model slugs will automatically redirect" and bill at the redirect target's rates. Today (2026-06-11) is past that date: the redirects are live. The per-model docs pages for the legacy slugs (`grok-4`, `grok-4-0709`, `grok-3`, `grok-3-fast`) now resolve to the grok-4.3 page showing $1.25/$0.20/$2.50 — direct confirmation that the slugs are aliases billing at target rates.

| Model id | Redirect target (source: may-15-retirement page) | `deprecated: true` verdict |
|---|---|---|
| grok-4-latest | grok-4.3 (alias of grok-4-0709; per-model page now resolves to grok-4.3) | CORRECT |
| grok-4-0709 | grok-4.3 (reasoning_effort low) — explicitly listed | CORRECT |
| grok-4-1-fast-reasoning | grok-4.3 (low) — explicitly listed | CORRECT |
| grok-4-1-fast-non-reasoning | grok-4.3 (none) — explicitly listed | CORRECT |
| grok-4-fast-reasoning | grok-4.3 (low) — explicitly listed | CORRECT |
| grok-4-fast-non-reasoning | grok-4.3 (none) — explicitly listed | CORRECT |
| grok-code-fast-1 | grok-build-0.1 — explicitly listed | CORRECT |
| grok-3-latest | grok-4.3 (none) — `grok-3` explicitly listed; `-latest` is its alias | CORRECT |
| grok-3-fast-latest | grok-4.3 — not on the May-15 table by name, but docs.x.ai/developers/models/grok-3-fast now resolves to the grok-4.3 page with grok-4.3 pricing | CORRECT |

Legacy pricing fields on these entries ($3/$15 for grok-4 family and grok-3, $5/$25 for grok-3-fast, $0.20/$0.50 fast families, $0.20/$1.50 grok-code-fast-1) match the rates these models historically carried, but xAI no longer publishes them — they are unverifiable against live docs and, more importantly, **no longer what calls cost**.

**Recommendation (one clear position):** reprice the deprecated entries to their redirect targets' rates — the 8 grok-4.3-redirected slugs to $1.25 / $0.20 cached / $2.50, and grok-code-fast-1 to grok-build-0.1's $1.00 / $0.20 cached / $2.00. Rationale: Sim computes execution cost at run time from the current `models.ts` values and stores the result in execution logs; past log rows are unaffected by a reprice, so nothing historical is lost. Meanwhile any workflow still pointed at a retired slug bills at redirect rates today, so the legacy numbers overestimate live costs by up to 6× (grok-4-latest: $15 vs $2.50 output). This is docs-backed (the retirement page states the redirect billing explicitly). **Disposition: APPLIED in this pass** — the 8 grok-4.3 redirects now carry $1.25 / $0.20 cached / $2.50 with `contextWindow: 1000000`, and grok-code-fast-1 carries grok-build-0.1's $1.00 / $0.20 cached / $2.00 (256k unchanged).

## Changes made in this pass

None to `models.ts` (per instructions, this pass writes only this justification doc). The verified pending fix:

- **all 13 xai entries: `capabilities.temperature.max` 1 → 2.** The xAI chat REST reference documents `temperature` as "between 0 and 2" (same range OpenAI uses). The repo UI uses this for slider bounds, so the current `max: 1` artificially halves the usable range. Source: https://docs.x.ai/developers/rest-api-reference/inference/chat

Changes from PR #4990 re-verified and confirmed correct: 9 deprecation flags, grok-4.20 trio reprice to $1.25/$2.50 with 1M context, defaultModel grok-4.3.

## Deliberately not changed

- **grok-4.3 `reasoningEffort` capability flag — not added.** The REST reference and reasoning docs confirm grok-4.3 supports `reasoning_effort` with `none` / `low` (default) / `medium` / `high` ("Only supported by grok-4.3"). However, `apps/sim/providers/xai/index.ts` forwards only `temperature` (verified by rg: single hit at line 101, `basePayload.temperature`); no `reasoning_effort` wiring exists, so the capability flag would be dead metadata. **Recommended follow-up:** wire `reasoning_effort` in the xai provider, then add the capability flag to grok-4.3. Note for that follow-up: per the reasoning docs, `presence_penalty`, `frequency_penalty`, and `stop` cannot be combined with reasoning, and grok-4.20-multi-agent uses a different control (`reasoning.effort`: low/medium/high/xhigh, controlling agent count, not reasoning depth).

- **grok-build-0.1 — not added.** grok-code-fast-1's successor: $1.00 input / $0.20 cached / $2.00 output, 256k context, "xAI's fast coding model trained specifically for agentic coding" (docs.x.ai/developers/models/grok-build-0.1). Recommended addition; adding models is separate work from validation.
- **grok-4.3 tiered >200k-token pricing — not modeled.** Sim's pricing schema is flat; base tier recorded (and xAI's own table is flat).

## Unverifiable

- **Original (pre-retirement) pricing of the 9 deprecated entries** — xAI docs no longer publish historical rates; values match known historical pricing but cannot be confirmed against a live source.
- **Release dates of deprecated entries** (2025-07-09, 2025-11-19, 2025-09-19, 2025-08-28, 2025-02-17) — consistent with historical announcements/slugs (e.g. `grok-4-0709`), not republished on live docs.
- **grok-4.3 / grok-4.20 official release dates on xAI docs** — per-model pages omit release dates. grok-4.3: 2026-04-30 corroborated by OpenRouter. grok-4.20: 2026-03-10 corroborated by secondary reporting of xAI API availability plus the `0309` snapshot slug; treated as verified-by-secondary-source.
