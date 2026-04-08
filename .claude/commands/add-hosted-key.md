---
description: Add hosted API key support to a tool so Sim provides the key when users don't bring their own
argument-hint: <service-name>
---

# Adding Hosted Key Support to a Tool

When a tool has hosted key support, Sim provides its own API key if the user hasn't configured one (via BYOK or env var). Usage is metered and billed to the workspace.

## Overview

| Step | What | Where |
|------|------|-------|
| 1 | Register BYOK provider ID | `tools/types.ts`, `app/api/workspaces/[id]/byok-keys/route.ts` |
| 2 | Research the API's pricing and rate limits | API docs / pricing page (before writing any code) |
| 3 | Add `hosting` config to the tool | `tools/{service}/{action}.ts` |
| 4 | Hide API key field when hosted | `blocks/blocks/{service}.ts` |
| 5 | Add to BYOK settings UI | BYOK settings component (`byok.tsx`) |
| 6 | Summarize pricing and throttling comparison | Output to user (after all code changes) |

## Step 1: Register the BYOK Provider ID

Add the new provider to the `BYOKProviderId` union in `tools/types.ts`:

```typescript
export type BYOKProviderId =
  | 'openai'
  | 'anthropic'
  // ...existing providers
  | 'your_service'
```

Then add it to `VALID_PROVIDERS` in `app/api/workspaces/[id]/byok-keys/route.ts`:

```typescript
const VALID_PROVIDERS = ['openai', 'anthropic', 'google', 'mistral', 'your_service'] as const
```

## Step 2: Research the API's Pricing Model and Rate Limits

**Before writing any `getCost` or `rateLimit` code**, look up the service's official documentation for both pricing and rate limits. You need to understand:

### Pricing

1. **How the API charges** — per request, per credit, per token, per step, per minute, etc.
2. **Whether the API reports cost in its response** — look for fields like `creditsUsed`, `costDollars`, `tokensUsed`, or similar in the response body or headers
3. **Whether cost varies by endpoint/options** — some APIs charge more for certain features (e.g., Firecrawl charges 1 credit/page base but +4 for JSON format, +4 for enhanced mode)
4. **The dollar-per-unit rate** — what each credit/token/unit costs in dollars on our plan

### Rate Limits

1. **What rate limits the API enforces** — requests per minute/second, tokens per minute, concurrent requests, etc.
2. **Whether limits vary by plan tier** — free vs paid vs enterprise often have different ceilings
3. **Whether limits are per-key or per-account** — determines whether adding more hosted keys actually increases total throughput
4. **What the API returns when rate limited** — HTTP 429, `Retry-After` header, error body format, etc.
5. **Whether there are multiple dimensions** — some APIs limit both requests/min AND tokens/min independently

Search the API's docs/pricing page (use WebSearch/WebFetch). Capture the pricing model as a comment in `getCost` so future maintainers know the source of truth.

### Setting Our Rate Limits

Our rate limiter (`lib/core/rate-limiter/hosted-key/`) uses a token-bucket algorithm applied **per billing actor** (workspace). It supports two modes:

- **`per_request`** — simple; just `requestsPerMinute`. Good when the API charges flat per-request or cost doesn't vary much.
- **`custom`** — `requestsPerMinute` plus additional `dimensions` (e.g., `tokens`, `search_units`). Each dimension has its own `limitPerMinute` and an `extractUsage` function that reads actual usage from the response. Use when the API charges on a variable metric (tokens, credits) and you want to cap that metric too.

When choosing values for `requestsPerMinute` and any dimension limits:

- **Stay well below the API's per-key limit** — our keys are shared across all workspaces. If the API allows 60 RPM per key and we have 3 keys, the global ceiling is ~180 RPM. Set the per-workspace limit low enough (e.g., 20-60 RPM) that many workspaces can coexist without collectively hitting the API's ceiling.
- **Account for key pooling** — our round-robin distributes requests across `N` hosted keys, so the effective API-side rate per key is `(total requests) / N`. But per-workspace limits are enforced *before* key selection, so they apply regardless of key count.
- **Prefer conservative defaults** — it's easy to raise limits later but hard to claw back after users depend on high throughput.

## Step 3: Add `hosting` Config to the Tool

Add a `hosting` object to the tool's `ToolConfig`. This tells the execution layer how to acquire hosted keys, calculate cost, and rate-limit.

```typescript
hosting: {
  envKeyPrefix: 'YOUR_SERVICE_API_KEY',
  apiKeyParam: 'apiKey',
  byokProviderId: 'your_service',
  pricing: {
    type: 'custom',
    getCost: (_params, output) => {
      if (output.creditsUsed == null) {
        throw new Error('Response missing creditsUsed field')
      }
      const creditsUsed = output.creditsUsed as number
      const cost = creditsUsed * 0.001 // dollars per credit
      return { cost, metadata: { creditsUsed } }
    },
  },
  rateLimit: {
    mode: 'per_request',
    requestsPerMinute: 100,
  },
},
```

### Hosted Key Env Var Convention

Keys use a numbered naming pattern driven by a count env var:

```
YOUR_SERVICE_API_KEY_COUNT=3
YOUR_SERVICE_API_KEY_1=sk-...
YOUR_SERVICE_API_KEY_2=sk-...
YOUR_SERVICE_API_KEY_3=sk-...
```

The `envKeyPrefix` value (`YOUR_SERVICE_API_KEY`) determines which env vars are read at runtime. Adding more keys only requires bumping the count and adding the new env var.

### Pricing: Prefer API-Reported Cost

Always prefer using cost data returned by the API (e.g., `creditsUsed`, `costDollars`). This is the most accurate because it accounts for variable pricing tiers, feature modifiers, and plan-level discounts.

**When the API reports cost** — use it directly and throw if missing:

```typescript
pricing: {
  type: 'custom',
  getCost: (params, output) => {
    if (output.creditsUsed == null) {
      throw new Error('Response missing creditsUsed field')
    }
    // $0.001 per credit — from https://example.com/pricing
    const cost = (output.creditsUsed as number) * 0.001
    return { cost, metadata: { creditsUsed: output.creditsUsed } }
  },
},
```

**When the API does NOT report cost** — compute it from params/output based on the pricing docs, but still validate the data you depend on:

```typescript
pricing: {
  type: 'custom',
  getCost: (params, output) => {
    if (!Array.isArray(output.searchResults)) {
      throw new Error('Response missing searchResults, cannot determine cost')
    }
    // Serper: 1 credit for <=10 results, 2 credits for >10 — from https://serper.dev/pricing
    const credits = Number(params.num) > 10 ? 2 : 1
    return { cost: credits * 0.001, metadata: { credits } }
  },
},
```

**`getCost` must always throw** if it cannot determine cost. Never silently fall back to a default — this would hide billing inaccuracies.

### Capturing Cost Data from the API

If the API returns cost info, capture it in `transformResponse` so `getCost` can read it from the output:

```typescript
transformResponse: async (response: Response) => {
  const data = await response.json()
  return {
    success: true,
    output: {
      results: data.results,
      creditsUsed: data.creditsUsed,  // pass through for getCost
    },
  }
},
```

For async/polling tools, capture it in `postProcess` when the job completes:

```typescript
if (jobData.status === 'completed') {
  result.output = {
    data: jobData.data,
    creditsUsed: jobData.creditsUsed,
  }
}
```

## Step 4: Hide the API Key Field When Hosted

In the block config (`blocks/blocks/{service}.ts`), add `hideWhenHosted: true` to the API key subblock. This hides the field on hosted Sim since the platform provides the key:

```typescript
{
  id: 'apiKey',
  title: 'API Key',
  type: 'short-input',
  placeholder: 'Enter your API key',
  password: true,
  required: true,
  hideWhenHosted: true,
},
```

The visibility is controlled by `isSubBlockHidden()` in `lib/workflows/subblocks/visibility.ts`, which checks both the `isHosted` feature flag (`hideWhenHosted`) and optional env var conditions (`hideWhenEnvSet`).

### Excluding Specific Operations from Hosted Key Support

When a block has multiple operations but some operations should **not** use a hosted key (e.g., the underlying API is deprecated, unsupported, or too expensive), use the **duplicate apiKey subblock** pattern. This is the same pattern Exa uses for its `research` operation:

1. **Remove the `hosting` config** from the tool definition for that operation — it must not have a `hosting` object at all.
2. **Duplicate the `apiKey` subblock** in the block config with opposing conditions:

```typescript
// API Key — hidden when hosted for operations with hosted key support
{
  id: 'apiKey',
  title: 'API Key',
  type: 'short-input',
  placeholder: 'Enter your API key',
  password: true,
  required: true,
  hideWhenHosted: true,
  condition: { field: 'operation', value: 'unsupported_op', not: true },
},
// API Key — always visible for unsupported_op (no hosted key support)
{
  id: 'apiKey',
  title: 'API Key',
  type: 'short-input',
  placeholder: 'Enter your API key',
  password: true,
  required: true,
  condition: { field: 'operation', value: 'unsupported_op' },
},
```

Both subblocks share the same `id: 'apiKey'`, so the same value flows to the tool. The conditions ensure only one is visible at a time. The first has `hideWhenHosted: true` and shows for all hosted operations; the second has no `hideWhenHosted` and shows only for the excluded operation — meaning users must always provide their own key for that operation.

To exclude multiple operations, use an array: `{ field: 'operation', value: ['op_a', 'op_b'] }`.

**Reference implementations:**
- **Exa** (`blocks/blocks/exa.ts`): `research` operation excluded from hosting — lines 309-329
- **Google Maps** (`blocks/blocks/google_maps.ts`): `speed_limits` operation excluded from hosting (deprecated Roads API)

## Step 5: Add to the BYOK Settings UI

Add an entry to the `PROVIDERS` array in the BYOK settings component so users can bring their own key. You need the service icon from `components/icons.tsx`:

```typescript
{
  id: 'your_service',
  name: 'Your Service',
  icon: YourServiceIcon,
  description: 'What this service does',
  placeholder: 'Enter your API key',
},
```

## Step 6: Summarize Pricing and Throttling Comparison

After all code changes are complete, output a detailed summary to the user covering:

### What to include

1. **API's pricing model** — how the service charges (per token, per credit, per request, etc.), the specific rates found in docs, and whether the API reports cost in responses.
2. **Our `getCost` approach** — how we calculate cost, what fields we depend on, and any assumptions or estimates (especially when the API doesn't report exact dollar cost).
3. **API's rate limits** — the documented limits (RPM, TPM, concurrent, etc.), which plan tier they apply to, and whether they're per-key or per-account.
4. **Our `rateLimit` config** — what we set for `requestsPerMinute` (and dimensions if custom mode), why we chose those values, and how they compare to the API's limits.
5. **Key pooling impact** — how many hosted keys we expect, and how round-robin distribution affects the effective per-key rate at the API.
6. **Gaps or risks** — anything the API charges for that we don't meter, rate limit dimensions we chose not to enforce, or pricing that may be inaccurate due to variable model/tier costs.

### Format

Present this as a structured summary with clear headings. Example:

```
### Pricing
- **API charges**: $X per 1M tokens (input), $Y per 1M tokens (output) — varies by model
- **Response reports cost?**: No — only token counts in `usage` field
- **Our getCost**: Estimates cost at $Z per 1M total tokens based on median model pricing
- **Risk**: Actual cost varies by model; our estimate may over/undercharge for cheap/expensive models

### Throttling
- **API limits**: 300 RPM per key (paid tier), 60 RPM (free tier)
- **Per-key or per-account**: Per key — more keys = more throughput
- **Our config**: 60 RPM per workspace (per_request mode)
- **With N keys**: Effective per-key rate is (total RPM across workspaces) / N
- **Headroom**: Comfortable — even 10 active workspaces at full rate = 600 RPM / 3 keys = 200 RPM per key, under the 300 RPM API limit
```

This summary helps reviewers verify that the pricing and rate limiting are well-calibrated and surfaces any risks that need monitoring.

## Checklist

- [ ] Provider added to `BYOKProviderId` in `tools/types.ts`
- [ ] Provider added to `VALID_PROVIDERS` in the BYOK keys API route
- [ ] API pricing docs researched — understand per-unit cost and whether the API reports cost in responses
- [ ] API rate limits researched — understand RPM/TPM limits, per-key vs per-account, and plan tiers
- [ ] `hosting` config added to the tool with `envKeyPrefix`, `apiKeyParam`, `byokProviderId`, `pricing`, and `rateLimit`
- [ ] `getCost` throws if required cost data is missing from the response
- [ ] Cost data captured in `transformResponse` or `postProcess` if API provides it
- [ ] `hideWhenHosted: true` added to the API key subblock in the block config
- [ ] Provider entry added to the BYOK settings UI with icon and description
- [ ] Env vars documented: `{PREFIX}_COUNT` and `{PREFIX}_1..N`
- [ ] Pricing and throttling summary provided to reviewer
