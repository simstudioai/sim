---
name: add-model
description: Add a new LLM model to `apps/sim/providers/models.ts` with every pricing and capability value verified against the provider's live API docs (no hallucination), plus the repo-side touchpoints that are not data-driven — hosted-key billing, tests, and provider-code handling. Use when adding a model to an existing provider in `apps/sim/providers/models.ts`.
---

# Add Model Skill

You add a new model entry to `apps/sim/providers/models.ts`. **Every numeric and capability claim MUST be derived from a live web fetch of the provider's official docs in this session.** Marketing emails, training data, and your prior knowledge are not sources of truth — they routinely hallucinate pricing, context windows, and capability lists.

## Hard rules (do not skip)

1. **Live-fetch or refuse.** Before writing the entry, you must successfully WebFetch the provider's official models/pricing page in this session. If you cannot reach an authoritative source for any field, **mark the field as UNVERIFIED in your report and ask the user before guessing**. Never fill in pricing or capabilities from memory.
2. **Two-source rule for pricing.** Cross-check input/output/cached pricing against at least one secondary source (OpenRouter, Artificial Analysis, CloudPrice, mem0, intuitionlabs). If sources disagree, the provider's own docs win — but flag the disagreement.
3. **Read the code before setting capability flags.** Capability flags are dead unless the provider's implementation under `apps/sim/providers/{provider}/` actually consumes them (see Consumption Matrix below). Setting a flag the provider ignores is a silent bug.
4. **Cite every fact.** Your final report must list the URL each value came from. No URL → not verified.

## Your Task

1. Identify provider and model id from user args
2. Live-fetch official docs + pricing page + capability/parameter pages + at least one secondary source
3. Apply the Consumption Matrix to know which capability flags are real
4. Read 2-3 sibling entries in `models.ts` and match their pattern exactly
5. Check the repo-side touchpoints that are NOT data-driven (hosted-key billing, tests, provider code)
6. Insert the entry, run `bun run lint`, print the verification report

## Step 1: Live source-of-truth lookup

In priority order — fetch all that exist for the provider:

| Provider | Models index | Pricing | Reasoning/parameter caveats |
|---|---|---|---|
| OpenAI | platform.openai.com/docs/models | openai.com/api/pricing | platform.openai.com/docs/guides/reasoning |
| Anthropic | docs.anthropic.com/en/docs/about-claude/models | anthropic.com/pricing | docs.anthropic.com/en/docs/build-with-claude/extended-thinking |
| Google (Gemini) | ai.google.dev/gemini-api/docs/models | ai.google.dev/pricing | ai.google.dev/gemini-api/docs/thinking |
| xAI | docs.x.ai/developers/models | docs.x.ai/developers/models (per-model detail page) | docs.x.ai/developers/model-capabilities/text/reasoning |
| Mistral | docs.mistral.ai/getting-started/models/models_overview | mistral.ai/pricing | n/a |
| DeepSeek | api-docs.deepseek.com/quick_start/pricing | same | api-docs.deepseek.com/guides/reasoning_model |
| Groq | console.groq.com/docs/models | groq.com/pricing | n/a |
| Cerebras | inference-docs.cerebras.ai/models | cerebras.ai/pricing | n/a |

Secondary verification (use at least one): `openrouter.ai/<provider>/<model>`, `artificialanalysis.ai/models/<model>`, `cloudprice.net/models/<provider>-<model>`.

Use a precise WebFetch prompt: *"Extract for {model_id}: exact model id string, context window in tokens, input price per 1M, cached input price per 1M, output price per 1M, max output tokens, supported reasoning effort levels, accepted parameters (temperature, top_p), release date. Do not fill in fields you cannot find."*

## Step 2: Consumption Matrix (which provider honors which capability)

| Capability | Honored by | Effect if set elsewhere |
|---|---|---|
| `temperature` | All providers (passed through if set) | Safe but inert on always-reasoning models that reject it |
| `toolUsageControl` | All providers (provider-level, not per-model) | n/a — set on `ProviderDefinition`, not models |
| `reasoningEffort` | `openai/core.ts`, `azure-openai`, `anthropic/core.ts` (mapped to thinking), `gemini/core.ts` | **Dead on xai, deepseek, mistral, groq, cerebras, openrouter, fireworks, bedrock, vertex** unless their core consumes it — re-grep before assuming |
| `verbosity` | `openai/core.ts`, `azure-openai/index.ts` only | Dead elsewhere |
| `thinking` | `anthropic/core.ts`, `gemini/core.ts` | Dead elsewhere |
| `nativeStructuredOutputs` | `anthropic/core.ts`, `fireworks/index.ts`, `openrouter/index.ts` | Dead on openai, xai, google, vertex, bedrock, azure-openai, deepseek, mistral, groq, cerebras |
| `maxOutputTokens` | Read by UI + executor for token estimation | Always meaningful — set if provider documents a cap |
| `computerUse` | `anthropic/core.ts` | Dead elsewhere |
| `deepResearch` | UI flag for routing to deep-research SKUs | Set only on actual deep-research model IDs |
| `memory: false` | Conversation persistence opt-out | Set only when model genuinely cannot maintain history (e.g., deep-research) |

**Always re-grep before relying on this table** — the codebase moves:

```bash
rg "reasoningEffort|reasoning_effort" apps/sim/providers/<provider>/
rg "verbosity" apps/sim/providers/<provider>/
rg "request\.thinking|thinking:" apps/sim/providers/<provider>/
rg "supportsNativeStructuredOutputs|nativeStructuredOutputs" apps/sim/providers/<provider>/
```

## Step 3: Match the provider's existing entry pattern

Open `apps/sim/providers/models.ts`, find `PROVIDER_DEFINITIONS[<provider>].models`, read 2-3 sibling entries. Match field order exactly:

```ts
{
  id: '<exact-api-id>',
  pricing: {
    input: <number>,
    cachedInput: <number>,  // omit if provider doesn't offer caching
    output: <number>,
    updatedAt: '<today YYYY-MM-DD>',
  },
  capabilities: {
    // only flags the provider actually consumes — see matrix
  },
  contextWindow: <tokens>,
  releaseDate: '<YYYY-MM-DD>',
  recommended: true,        // only if new flagship; ask user before swapping
  speedOptimized: true,     // only on smallest/fastest tier
  deprecated: true,         // only on retired models
}
```

### Reseller providers (azure-openai, azure-anthropic, vertex, bedrock, openrouter)

Model id MUST be prefixed: `azure/`, `azure-anthropic/`, `vertex/`, `bedrock/`, `openrouter/`. Pricing usually mirrors the upstream provider but verify on the reseller's own pricing page.

### Insertion order

Within a family, newest first (matches existing convention: GPT-5.5 above GPT-5.4 above GPT-5.2). Across families, biggest/flagship at top of list.

### `recommended` / `speedOptimized`

- At most one or two `recommended: true` per provider — the current flagship(s).
- If you're adding a new flagship, ask the user before removing `recommended` from the previous flagship. Never silently flip it.
- `speedOptimized: true` only on the smallest/fastest tier (nano, flash-lite, haiku class).

## Step 4: Repo-side touchpoints beyond the entry

Adding the `models.ts` entry is most of the job because nearly every consumer is **data-driven** and picks the model up automatically: the ~40 query helpers in `models.ts` / `providers/utils.ts`, the public `/models` catalog (`app/(landing)/models/utils.ts` iterates `PROVIDER_DEFINITIONS`), the agent-block model dropdown, and copilot's `isKnownModelId` / `suggestModelIdsForUnknownModel` validation. The touchpoints below are the exceptions — they are **not** data-driven, so check each one.

### Hosted = auto-billed, by provider

`getHostedModels()` in `apps/sim/providers/models.ts` returns **every** model under `openai`, `anthropic`, and `google`:

```ts
export function getHostedModels(): string[] {
  return [
    ...getProviderModels('openai'),
    ...getProviderModels('anthropic'),
    ...getProviderModels('google'),
  ]
}
```

So a model added to any of those three providers is **automatically served with Sim's rotating hosted key and billed** to the workspace via `shouldBillModelUsage()` (`providers/utils.ts`). Before you insert:

- **If the model should be BYOK-only / never-billed**, do NOT drop it under `openai`/`anthropic`/`google` as-is — that silently enrolls it in hosted billing. Confirm hosting/billing intent with the user. (Precedent: Ollama Cloud is a deliberately separate `isReseller` provider specifically to stay BYOK-only/never-billed.)
- **If the model should be hosted**, the deployment must actually have a key for it — the provider's `{PREFIX}_COUNT` / `{PREFIX}_1..N` env vars must be set, or hosted runs fail at execution time.
- State the hosted/billing status explicitly in the verification report.

### Tests with hardcoded model IDs

`bun run lint` does **not** run tests. A few tests assert specific model IDs and can break or need updating when you touch a hosted or flagship model:

- `apps/sim/providers/utils.test.ts` — asserts membership of `getHostedModels()` / `shouldBillModelUsage()`
- `apps/sim/providers/index.test.ts` and serializer tests — reference concrete model IDs

```bash
rg "<new-model-id>|getHostedModels|shouldBillModelUsage" apps/sim/providers/*.test.ts
```

If anything matches, run the affected provider tests and update assertions as needed.

### New API behavior is NOT data-driven

The Consumption Matrix (Step 2) tells you which capability *flags* are honored by existing provider code. But if the new model needs **net-new** request handling that the provider doesn't implement yet — a new beta header (e.g. Anthropic's `anthropic-beta` structured-outputs header in `anthropic/index.ts`), a new thinking/reasoning encoding, a Responses-API quirk — you must edit `apps/sim/providers/<provider>/core.ts` / `index.ts`. Setting a flag whose behavior isn't implemented is a silent no-op.

### Wrong family entirely?

- **Embedding or rerank model** → it does NOT go in the `models[]` array. Use `EMBEDDING_MODEL_PRICING` / `RERANK_MODEL_PRICING` in `models.ts` instead.
- **Brand-new provider** (not just a new model under an existing one) → much larger surface: add the id to `ProviderId` in `providers/types.ts`, a registry entry in `providers/registry.ts`, a provider implementation under `providers/<id>/`, an icon in `components/icons.tsx`, and the `PROVIDER_DEFINITIONS` block. That is beyond this skill — tell the user.

## Step 5: Write, lint

```bash
bun run lint
```

Lint must pass before reporting done. **If lint fails:** read the error, fix the syntax/typing issue in the entry you just wrote (do not delete the entry — it's the work product), re-run lint, and note the fix in a "Lint adjustments" line in the verification report. Never report done with lint failing.

## Step 6: Verification report (mandatory format)

End with this exact structure:

```markdown
### Verification — <model-id>

| Field | Value | Source URL | Status |
|---|---|---|---|
| `id` | `grok-4.3` | https://docs.x.ai/... | ✓ verified |
| `contextWindow` | 1,000,000 | https://docs.x.ai/... + https://openrouter.ai/... | ✓ verified (2 sources agree) |
| `input` | $1.25/M | https://docs.x.ai/... | ✓ verified |
| `cachedInput` | $0.20/M | https://cloudprice.net/... | ⚠️ single source |
| `output` | $2.50/M | https://docs.x.ai/... + https://openrouter.ai/... | ✓ verified |
| `capabilities.temperature` | `{ min: 0, max: 1 }` | matches sibling entries | — pattern-match only |
| `capabilities.reasoningEffort` | NOT SET | provider docs say API rejects it for this model | ✓ correctly omitted |
| `releaseDate` | 2026-04-30 | https://docs.x.ai/... announcement | ✓ verified |
| hosted/billing | BYOK-only (xai not in `getHostedModels`) | `providers/models.ts` | — confirmed intent |

**Disagreements**
- _none_ OR _OpenRouter says X, provider docs say Y — used Y per provider rule_

**Unverified fields**
- _none_ OR _<field>: could not find authoritative source — left as <X> based on sibling pattern; please confirm_
```

If any row is ⚠️ single-source or "unverified," **state it plainly to the user and ask whether to proceed**. Do not silently merge.

## What to do if you cannot find a source

Omitting a field is **not the same as verifying it**. Any field you cannot confirm from a live fetch must be **both** omitted from the entry **and** listed as ❓ UNVERIFIED in the report's "Unverified fields" section, with the URLs you attempted. Then ask the user to confirm before merging.

- Pricing missing → do NOT guess. Omit `cachedInput`. Mark ❓ UNVERIFIED. Ask the user for the price or the docs URL.
- Context window missing → do NOT guess. Ask the user; mark ❓ UNVERIFIED.
- Release date missing → omit the field; mark ❓ UNVERIFIED in the report.
- Capability uncertain → omit the flag (safer than setting a dead/wrong one); mark ❓ UNVERIFIED so the user knows you didn't confirm it either way.

## Anti-patterns this skill exists to prevent

- ❌ Trusting a marketing email (xAI's grok-4.3 email claimed "3 reasoning efforts" but the API rejects `reasoning_effort` — verified by official docs only)
- ❌ Setting `nativeStructuredOutputs: true` on xai/openai/google (dead — only anthropic/fireworks/openrouter consume it)
- ❌ Setting `thinking` on non-Anthropic/non-Gemini providers
- ❌ Setting `verbosity` on anything other than OpenAI gpt-5.x
- ❌ Copying `pricing.updatedAt` from a sibling instead of using today's date
- ❌ Inventing a `cachedInput` price by dividing input by 4 (varies by provider — find an explicit number)
- ❌ Stamping `recommended: true` on the new model without removing it from the previous flagship
- ❌ Adding a BYOK-only model under `openai`/`anthropic`/`google` (silently enrolls it in hosted billing via `getHostedModels()`)
- ❌ Reporting "done" after only `bun run lint` when you touched a hosted (openai/anthropic/google) or flagship model with assertions in `providers/utils.test.ts`
- ❌ Reporting "done" with any UNVERIFIED row in the table
