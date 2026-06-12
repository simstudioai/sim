# Validation: EMBEDDING_MODEL_PRICING, RERANK_MODEL_PRICING, and dynamic providers

- **Date:** 2026-06-11
- **File validated:** `apps/sim/providers/models.ts` (`EMBEDDING_MODEL_PRICING` ~L3289, `RERANK_MODEL_PRICING` ~L3320, dynamic provider definitions ~L87–191, L2503–2515, update functions ~L3190–3287)
- **Method:** Every numeric claim checked via live WebFetch against the provider's first-party docs, with at least one secondary tracker where available. WebSearch used as fallback when a page truncated. No edits were made to `models.ts`.
- **Primary sources:**
  - OpenAI: `developers.openai.com/api/docs/models/text-embedding-3-small` / `.../text-embedding-3-large` / `.../text-embedding-ada-002` (the aggregate pricing page truncates before the embeddings table; per-model pages carry the prices)
  - Google: `ai.google.dev/gemini-api/docs/pricing`
  - Cohere: `cohere.com/pricing` (Model Vault only — per-search API pricing not rendered), `docs.cohere.com/docs/how-does-cohere-pricing-work` (confirms rerank is billed per search, no numbers), `docs.cohere.com/docs/rerank` (model list)
  - Secondary trackers: Vercel AI Gateway (`vercel.com/ai-gateway/models/rerank-v4-pro`, `.../rerank-v4-fast`), eesel.ai Cohere pricing guide, metacto.com Cohere pricing deep dive, cloudprice.net, TokenMix/costgoat (OpenAI embeddings)
  - Provider API docs: `docs.fireworks.ai/api-reference/post-chatcompletions`, `docs.together.ai/reference/chat-completions`, `openrouter.ai/docs` parameters reference, `docs.ollama.com/api/openai-compatibility`, `docs.baseten.co/development/model-apis/overview`

## EMBEDDING_MODEL_PRICING

| Entry | Field | Value in code | Verified value | Source | Verdict |
|---|---|---|---|---|---|
| `text-embedding-3-small` | input | $0.02 / 1M | $0.02 / 1M | developers.openai.com model page; TokenMix secondary | CORRECT |
| `text-embedding-3-small` | output | $0.00 | n/a (embeddings bill input only) | OpenAI docs | CORRECT |
| `text-embedding-3-large` | input | $0.13 / 1M | $0.13 / 1M | developers.openai.com model page; TokenMix secondary | CORRECT |
| `text-embedding-3-large` | output | $0.00 | n/a | OpenAI docs | CORRECT |
| `text-embedding-ada-002` | input | $0.10 / 1M | $0.10 / 1M | developers.openai.com model page; search secondary | CORRECT |
| `text-embedding-ada-002` | output | $0.00 | n/a | OpenAI docs | CORRECT |
| `gemini-embedding-001` | input | $0.15 / 1M | $0.15 / 1M (paid tier, standard; batch is $0.075) | ai.google.dev/gemini-api/docs/pricing | CORRECT |
| `gemini-embedding-001` | output | $0.00 | n/a | Google docs | CORRECT |

## RERANK_MODEL_PRICING (per search unit = 1 query × ≤100 docs)

| Entry | Value in code | Verified value | Source | Verdict |
|---|---|---|---|---|
| `rerank-v4.0-pro` | $0.0025 / search | $2.50 / 1k searches ($0.0025) | Vercel AI Gateway rerank-v4-pro page ("$2.5/K, billed per search query"); eesel.ai ("$0.0025 / search") | CORRECT |
| `rerank-v4.0-fast` | $0.002 / search | $2.00 / 1k searches ($0.002) | Vercel AI Gateway rerank-v4-fast page ("$2/K"); eesel.ai ("$0.002 / search") | CORRECT |
| `rerank-v3.5` | $0.002 / search | $2.00 / 1k searches ($0.002) Cohere direct & Bedrock | metacto ("$2.00 per 1,000 searches"); cloudprice.net ($0.0020/unit, Cohere + Bedrock rows agree) | CORRECT |

Notes:

- `cohere.com/pricing` currently only renders Model Vault (dedicated instance) hourly pricing; the per-search API table is JS-rendered and not fetchable. `docs.cohere.com/docs/how-does-cohere-pricing-work` confirms rerank is "priced based on the quantity of searches" (per-search, not per-token), which validates the `perSearchUnit` modeling and the ≤100-doc cap comment in the code.
- Conflicting source resolved: OpenRouter lists `cohere/rerank-v3.5` at $0.001/search, but that is OpenRouter's reseller price, not Cohere first-party. Sim calls Cohere directly, so $0.002 stands.
- Cohere also offers `rerank-english-v3.0` and `rerank-multilingual-v3.0`; Sim does not expose them, so no entries are needed.

## Dynamic providers (provider-level config sanity pass)

All eight have empty static `models: []` populated at runtime via `update*Models()` (pricing zeroed, `updatedAt` set to today — intentional for BYOK/reseller providers). `modelPatterns` prefixes match each provider's `update*` function and prefix-stripping in the provider implementations.

| Provider | Config checked | Verdict |
|---|---|---|
| `fireworks` | temp 0–2, toolUsageControl true, pattern `/^fireworks\//` | CORRECT — Fireworks docs: temperature "between 0 and 2", full `tool_choice` support (`none`/`auto`/`required`/named) |
| `together` | temp 0–2, toolUsageControl true, pattern `/^together\//` | **DISCREPANCY** — Together's own API reference documents temperature as "a decimal number from 0-1"; `tool_choice` supported. Sim declares max 2. Flagged below; not changed in this pass |
| `baseten` | temp 0–2, toolUsageControl true, pattern `/^baseten\//` | SANE — Model APIs are OpenAI-compatible (docs.baseten.co); exact temp bounds not published, 0–2 follows the OpenAI convention |
| `openrouter` | temp 0–2, toolUsageControl true, pattern `/^openrouter\//` | CORRECT — OpenRouter docs: temperature 0.0–2.0, default 1.0 |
| `ollama-cloud` | temp 0–2, toolUsageControl **true**, pattern `/^ollama-cloud\//` | **QUESTIONABLE** — Ollama's OpenAI-compat layer (same API at `ollama.com/v1`) explicitly lists `tool_choice` as unsupported, and Sim's own shared core (`apps/sim/providers/ollama/core.ts:140-147`) degrades forced tool selection to `auto` with a warning. Local `ollama` correctly sets `toolUsageControl: false`; `ollama-cloud: true` is inconsistent. Flagged below; not changed in this pass |
| `vllm` | temp 0–2, toolUsageControl true, `defaultModel: 'vllm/generic'`, pattern `/^vllm\//` | SANE — vLLM's OpenAI-compatible server accepts temperature ≥0 (no hard cap of 2); 0–2 is a reasonable UI cap. `vllm/generic` matches the pattern and is the documented placeholder (only other reference is the vllm provider test) |
| `litellm` | temp 0–2, toolUsageControl true, pattern `/^litellm\//` | SANE — proxy passthrough; effective bounds depend on the upstream model, 0–2 is the OpenAI-convention cap |
| `ollama` (local) | toolUsageControl false ("does not support tool_choice"), no temp block, `modelPatterns: []` | CORRECT — docs.ollama.com OpenAI-compatibility page lists `tool_choice` as unsupported (temperature is supported); empty patterns are intentional since local model names are arbitrary and matched via the providers store |

## `gemini` vs `google` provider key

- `PROVIDER_DEFINITIONS` contains only `google` (L1303, `defaultModel: 'gemini-2.5-pro'`, patterns `/^gemini/`, `/^deep-research/`). There is no `gemini` registry key, and nothing calls `getProviderModels('gemini')` — all callers use `'google'` (models.ts L3163, `apps/sim/providers/google/index.ts:21`).
- `apps/sim/providers/gemini/` exists but is **not a provider**: it holds only `core.ts`/`types.ts` (shared Gemini execution logic consumed by both the `google` and `vertex` providers). No `index.ts`, not registered in `registry.ts`.
- The only `'gemini'` string key is the rotating-API-key namespace: `apps/sim/providers/utils.ts:891` maps provider `google` → `getRotatingApiKey('gemini')`, matching the `GEMINI_API_KEY_*` env convention in `apps/sim/lib/core/config/api-keys.ts`. Intentional; nothing structurally odd.

## Changes made in this pass

None. All `EMBEDDING_MODEL_PRICING` and `RERANK_MODEL_PRICING` values verified correct; instructions prohibited edits to `models.ts`.

## Deliberately not changed

- **`together` temperature max 2 vs documented 0–1:** Together's API reference documents 0–1, but the endpoint is OpenAI-compatible and tolerantly accepts higher values in practice; tightening to `max: 1` would change UI slider behavior for existing workflows. Left for a deliberate follow-up decision.
- **`ollama-cloud` `toolUsageControl: true`:** inconsistent with local `ollama: false` and with Ollama's documented lack of `tool_choice`. Runtime is already safe (shared core degrades forced selection to `auto` with a warning), so this only mis-advertises a capability in the UI. Left for follow-up.
- Dynamic-model zero pricing (`input: 0, output: 0`) in all `update*Models()` functions — intentional for BYOK/reseller providers where Sim doesn't bill model usage.

## Unverifiable

- **Cohere first-party per-search price page:** `cohere.com/pricing`'s API pricing table does not render server-side; per-search numbers were confirmed via two independent secondary trackers per model plus Cohere docs confirming the per-search billing unit.
- **Baseten and LiteLLM exact temperature bounds:** neither publishes a numeric range (OpenAI-compatible passthrough); 0–2 judged sane by convention rather than verified.
- **vLLM upper temperature bound:** vLLM accepts temperatures above 2; the 0–2 cap is a UI choice, not a provider-documented limit.
