---
description: Validate a model entry (or every model in a provider) in apps/sim/providers/models.ts against the provider's live API docs (no hallucination — reports what cannot be verified)
argument-hint: <provider> [model-id]
---

# Validate Model Skill

You audit one or more model entries in `apps/sim/providers/models.ts` against the provider's official live API docs. **Hallucinated pricing and capabilities are the #1 failure mode in this file.** Every numeric and capability claim must be re-derived from a live web fetch in this session — not from memory, not from training data, not from the user's marketing email.

## Hard rules (do not skip)

1. **Live-fetch or report unverified.** Each field must be backed by a live WebFetch in this session. If you cannot reach an authoritative URL for a field, mark it **UNVERIFIED** in the report — do not silently confirm it from memory.
2. **Cite every fact.** Every value in the report must show the source URL it was checked against. No URL → mark UNVERIFIED.
3. **Two-source rule for pricing.** Cross-check input/output/cached against at least one secondary source (OpenRouter, Artificial Analysis, CloudPrice). If sources disagree, the provider's own docs win — flag the disagreement.
4. **Inspect provider implementation before flagging capability mismatches.** A capability flag in `models.ts` is dead unless the provider's code under `apps/sim/providers/{provider}/` consumes it (see Consumption Matrix below). Setting a flag the provider ignores is a warning, not a critical.
5. **Never auto-fix without printing the diff.** Show the user the proposed diff before applying. Get confirmation.

## Your Task

When invoked as `/validate-model <provider> [model-id]`:

1. Read the target entries from `models.ts`
2. Live-fetch the provider's official models, pricing, and capability/reasoning pages + at least one secondary source for pricing
3. Inspect the provider implementation to know which flags are actually consumed
4. Run the checklist below per model
5. Report findings (critical / warning / suggestion / unverified) with every cell linked to its source URL
6. Offer to fix; on confirm, edit `models.ts` in a single pass and re-lint

If `model-id` is omitted, validate every model in the provider.

## Step 1: Read entries from `models.ts`

Capture per model: `id`, full `pricing`, full `capabilities`, `contextWindow`, `releaseDate`, `recommended`, `speedOptimized`, `deprecated`.

## Step 2: Live-fetch authoritative sources

Use the canonical provider URL table in `add-model.md` (Step 1) as the single source of truth — fetch the models index, pricing, and reasoning/parameter caveats pages listed there for the target provider. If you update one table, update the other in the same change.

Secondary cross-check (use at least one): OpenRouter, Artificial Analysis, CloudPrice.

If a fetch fails (404, timeout, paywall), record the URL attempted and mark dependent fields UNVERIFIED.

## Step 3: Build the consumption map for this provider

Re-grep before trusting the snapshot below:

```bash
rg "reasoningEffort|reasoning_effort" apps/sim/providers/<provider>/
rg "verbosity" apps/sim/providers/<provider>/
rg "request\.thinking|thinking:" apps/sim/providers/<provider>/
rg "supportsNativeStructuredOutputs|nativeStructuredOutputs" apps/sim/providers/<provider>/
```

Snapshot (verify before relying):

| Capability | Consumed by |
|---|---|
| `reasoningEffort` | `openai/core.ts`, `azure-openai`, `anthropic/core.ts` (mapped via thinking), `gemini/core.ts` |
| `verbosity` | `openai/core.ts`, `azure-openai/index.ts` |
| `thinking` | `anthropic/core.ts`, `gemini/core.ts` |
| `nativeStructuredOutputs` | `anthropic/core.ts`, `fireworks/index.ts`, `openrouter/index.ts` |
| `computerUse` | `anthropic/core.ts` |
| `temperature` | All providers (passthrough) |

A flag set in `models.ts` but not in the consumption list for this provider = **warning: dead flag**.

## Step 4: Run the checklist

For each model, evaluate every row. Statuses: ✓ matches docs, ✗ disagrees, ⚠️ single-source, ❓ UNVERIFIED (could not fetch).

### Identity
- [ ] `id` exactly matches provider's API model identifier (case, dots, dashes, prefix for resellers)
- [ ] `releaseDate` matches launch announcement
- [ ] `deprecated: true` set if provider has announced retirement (or removed from active list)

### Pricing (per 1M tokens, USD)
- [ ] `pricing.input` matches provider pricing page
- [ ] `pricing.output` matches provider pricing page
- [ ] `pricing.cachedInput` matches provider's documented cached/prompt-cache rate (or is correctly omitted if no caching offered)
- [ ] `pricing.updatedAt` is recent — warn if older than 60 days

### Context & output limits
- [ ] `contextWindow` matches docs (in tokens)
- [ ] `capabilities.maxOutputTokens` matches documented output cap (or is correctly omitted if "no output limit")

### Capabilities (each must be DOCUMENTED-AS-SUPPORTED **and** CONSUMED-BY-PROVIDER-CODE)
- [ ] `temperature` — provider accepts it for this model (reasoning-always-on models often reject)
- [ ] `reasoningEffort.values` — list matches docs; **omitted** for always-reasoning models that reject the parameter (e.g., grok-4.3, where xAI docs explicitly state `reasoning_effort` is not supported). Verify per model — some always-reasoning models (e.g., OpenAI's o-series) DO accept `reasoning_effort` and should keep the flag.
- [ ] `verbosity.values` — only on OpenAI gpt-5.x family; values match docs
- [ ] `thinking.levels` + `thinking.default` — only on Anthropic/Gemini; values match docs
- [ ] `nativeStructuredOutputs` — only on anthropic/fireworks/openrouter; provider must document Structured Outputs / JSON-mode for this model
- [ ] `toolUsageControl` — provider supports `tool_choice` semantics
- [ ] `computerUse` — provider implements computer-use loop AND model is a computer-use SKU
- [ ] `deepResearch` — only on actual deep-research SKUs
- [ ] `memory: false` — only when the model genuinely cannot maintain conversation history

### Flags
- [ ] `recommended: true` — at most one or two per provider; should be current flagship
- [ ] `speedOptimized: true` — only on smallest/fastest tier (nano / flash-lite / haiku class)

## Step 5: Report (mandatory format)

For each model, emit a table with one row per checklist item. Every row that claims ✓ must have a URL.

```markdown
### Validation — <model-id>

| Field | Repo | Live docs | Source URL | Status |
|---|---|---|---|---|
| `input` | $1.25/M | $1.25/M | https://docs.x.ai/... | ✓ |
| `cachedInput` | $0.50/M | $0.20/M | https://cloudprice.net/... | ✗ stale (price cut not picked up) |
| `reasoningEffort` | low/medium/high | rejected by API | https://docs.x.ai/.../reasoning | ✗ inert — selecting silently no-ops |
| `contextWindow` | 1,000,000 | 1,000,000 | https://docs.x.ai/... + https://openrouter.ai/... | ✓ (2 sources) |
| `releaseDate` | 2026-04-30 | not found in scraped pages | _attempted: docs.x.ai, x.ai/news_ | ❓ UNVERIFIED |

**Findings**
- 🔴 critical — `cachedInput` is wrong: docs say $0.20/M, repo has $0.50/M
- 🟡 warning — `reasoningEffort` is set but provider rejects it for this model (xAI docs explicitly: "reasoning_effort is not supported by grok-4.3")
- 🔵 suggestion — `pricing.updatedAt` is 90 days old; refresh
- ❓ unverified — `releaseDate` could not be confirmed from any fetched page; ask user

**Disagreements between sources**
- _none_ OR _OpenRouter says $X, provider docs say $Y — went with provider docs_
```

End each multi-model run with a summary count: `N models checked · X critical · Y warnings · Z suggestions · W unverified`.

## Step 6: Offer to fix

After reporting, ask: *"Want me to fix the critical and warning items? I'll print the diff first."* On yes:

1. Print the proposed diff (do not apply yet)
2. Get user confirmation
3. Edit `models.ts` in a single pass
4. Run `bun run lint`
5. Re-run only the failed rows of the checklist on the new state

## Severity definitions

- 🔴 **critical** — wrong number or wrong identifier that misleads users about cost or breaks API calls. Examples: incorrect pricing, wrong model id, wrong context window, capability the API rejects.
- 🟡 **warning** — dead code or internal inconsistency. Examples: capability flag the provider ignores, multiple `recommended: true` per provider, `pricing.updatedAt` >60 days old, missing `deprecated: true` on retired model.
- 🔵 **suggestion** — style/consistency. Examples: field order, missing `speedOptimized` on a clearly smallest-tier model.
- ❓ **unverified** — could not fetch an authoritative source for this field. Surface it; never silently confirm.

## Common bugs this skill catches

- Pricing drift after a provider price cut (very common — providers cut quarterly)
- `reasoningEffort` set on always-reasoning models that reject the parameter (grok-4.3, o3-pro pattern)
- `nativeStructuredOutputs` set on providers that don't consume the flag (dead)
- `thinking` set on non-Anthropic/non-Gemini providers
- `verbosity` set on non-gpt-5.x models
- Wrong context window (e.g., 128k claimed vs 200k actual)
- Stale `pricing.updatedAt`
- Multiple `recommended: true` per provider after a flagship swap
- Missing `deprecated: true` on retired models (e.g., the xAI batch retiring May 15, 2026)

## What "I cannot verify this" looks like

If, after fetching the documented sources, a field cannot be confirmed:

- Mark the row ❓ UNVERIFIED with the URL(s) attempted
- Surface it in the **Findings** section with severity ❓
- Do NOT mark the validation as passed
- Ask the user for a docs URL or guidance before changing anything

The skill is allowed to say *"I could not verify the cached input price for grok-4.3 from the official xAI docs in this session — I attempted [URLs] without finding the value. Third-party sources [URL1, URL2] both report $0.20/M. Confirm before I update."* That is correct behavior. Hallucinating a number is not.
