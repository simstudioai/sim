---
name: add-enrichment
description: Add a code-defined table enrichment (registry entry) under `apps/sim/enrichments/` backed by an ordered provider cascade, ensuring every provider tool it calls has hosted-key support. Use when adding a per-row table enrichment that fills cells via existing Sim tools.
---

# Adding a Table Enrichment

Enrichments are code-defined entries in `apps/sim/enrichments/` that run **directly per table row** (no workflow). Each enrichment declares inputs, outputs, and an ordered list of **providers**; the cascade runner tries providers in order and the first non-empty result fills the cell. Each provider calls one existing Sim tool via `executeTool`, which injects the workspace's BYOK key or a **hosted key** and bills usage automatically.

Because enrichments run on Sim's hosted keys by default, **every provider tool you reference must have hosted-key support** — otherwise it can only run when the workspace brings its own key. This command makes that check a required step.

## Overview

| Step | What | Where |
|------|------|-------|
| 1 | Pick the data-source tool(s) for each output | `tools/{service}/` + `tools/registry.ts` |
| 2 | **Verify each tool has `hosting`; if not, run `/add-hosted-key`** | `tools/{service}/{action}.ts` |
| 3 | Write the enrichment definition | `enrichments/{name}/{name}.ts` + `index.ts` |
| 4 | Register it | `enrichments/registry.ts` |
| 5 | Verify | tsc / biome / manual run |

## Architecture (what you're plugging into)

- **`enrichments/types.ts`** — `EnrichmentConfig { id, name, description, icon, inputs, outputs, providers }` and `EnrichmentProvider { id, label, toolId, buildParams, mapOutput }`. Providers are **plain data** (no `@/tools` import) so the catalog stays client-safe.
- **`enrichments/providers.ts`** — `toolProvider(...)` (typed passthrough) plus shared input helpers: `str(v)`, `normalizeDomain(v)`, `firstNonEmpty(arr)`, `splitName(fullName)`.
- **`enrichments/run.ts`** — the server-only cascade runner. Calls `executeTool(provider.toolId, { ...params, _context: { workspaceId } })`, accumulates hosted-key cost, returns the first non-empty mapped result. **You do not edit this** — it works for any registry entry.
- **`enrichments/registry.ts`** — `ENRICHMENT_REGISTRY` / `ALL_ENRICHMENTS` / `getEnrichment`. Register new entries here.

Outputs automatically become table columns; billing, the catalog/sidebar UI, the column meta-header icon, and per-row execution all work with no extra wiring.

## Step 1: Pick the data-source tool(s)

For each output the enrichment produces, decide which existing tool provides it. Look up the service's API and the tool in `apps/sim/tools/{service}/` (e.g. `hunter_email_finder`, `pdl_person_enrich`, `pdl_company_enrich`). Confirm:

- The tool id is registered in `apps/sim/tools/registry.ts`.
- Its `params` accept what you can derive from table columns (read the tool's `params`).
- Its `outputs` / `transformResponse` actually expose the field you need (read the real output shape — don't assume).

Order providers **cheapest / most-likely-to-hit first**; the cascade stops at the first non-empty result. Apollo / LinkedIn are not hosted-safe (ToS) — don't use them.

## Step 2: Verify hosted-key support — chain to `/add-hosted-key` if missing

**This is the required gate.** For every tool a provider calls, open `apps/sim/tools/{service}/{action}.ts` and check for a `hosting` block:

```typescript
hosting: {
  envKeyPrefix: 'SERVICE_API_KEY',
  apiKeyParam: 'apiKey',
  byokProviderId: 'service',
  pricing: { /* ... */ },
  rateLimit: { /* ... */ },
}
```

- **If `hosting` is present** — good. Note the `envKeyPrefix`; the deployment needs `{PREFIX}_COUNT` + `{PREFIX}_1..N` env vars set for the hosted key to actually resolve at runtime (ops concern, not code). If those env vars aren't set in the target environment, the provider will only run with a workspace BYOK key.
- **If `hosting` is absent** — the tool can't use a Sim-provided key, so the enrichment would silently produce blank cells on hosted Sim. **Stop and run `/add-hosted-key <service>`** to add hosted-key support to that tool first, then come back. Do this for every provider tool that lacks it.

Why it matters: the cascade runner only bills (and only reads `output.cost.total`) when `executeTool` injected a hosted key, which requires the tool's `hosting` config. No `hosting` → no hosted key → the enrichment depends entirely on per-workspace BYOK.

## Step 3: Write the enrichment definition

Create `apps/sim/enrichments/{name}/{name}.ts` and a barrel `index.ts`. Mirror the existing entries (`work-email`, `phone-number`, `company-domain`, `company-info`).

```typescript
import { SomeIcon } from 'lucide-react'
import { filterUndefined } from '@sim/utils/object'
import { normalizeDomain, splitName, str, toolProvider } from '@/enrichments/providers'
import type { EnrichmentConfig } from '@/enrichments/types'

export const myEnrichment: EnrichmentConfig = {
  id: 'my-enrichment',
  name: 'My Enrichment',
  description: 'One concise sentence describing what it finds.',
  icon: SomeIcon,
  inputs: [
    // Person enrichments take a single canonical `fullName` (Clay-style);
    // split it with splitName() for tools that need first/last.
    { id: 'fullName', name: 'Full name', type: 'string', required: true },
    { id: 'companyDomain', name: 'Company domain', type: 'string' },
  ],
  outputs: [{ id: 'value', name: 'value', type: 'string' }],
  providers: [
    toolProvider({
      id: 'provider-a',
      label: 'Provider A',
      toolId: 'service_action', // must have `hosting` (Step 2)
      buildParams: (inputs) => {
        // Return null when there aren't enough inputs → cascade skips this provider.
        const name = splitName(inputs.fullName)
        const domain = normalizeDomain(inputs.companyDomain)
        if (!name || !domain) return null
        return { domain, first_name: name.firstName, last_name: name.lastName }
      },
      mapOutput: (output) => {
        // Return { [outputId]: value } on a hit, or null to fall through.
        const value = str(output.value)
        return value ? { value } : null
      },
    }),
    // ...additional fallback providers, in priority order.
  ],
}
```

```typescript
// apps/sim/enrichments/{name}/index.ts
export { myEnrichment } from './my-enrichment'
```

Rules:
- Keep the file **client-safe**: import only `lucide-react`, `@sim/utils/*`, `@/enrichments/providers`, and the types. **Never import `@/tools`** here — the runner does the tool call.
- `buildParams` returns `null` when inputs are insufficient (provider skipped). `mapOutput` returns `null`/empty for a miss (falls through). Use `filterUndefined` when assembling optional tool params; coerce numbers explicitly (don't pass `''` to number outputs).
- Output `id`s are the keys `mapOutput` returns; output `name`s are the default column names (the user can rename them in the config).

## Step 4: Register it

In `apps/sim/enrichments/registry.ts`, import and add the entry (catalog order is registration order):

```typescript
import { myEnrichment } from '@/enrichments/my-enrichment'

export const ENRICHMENT_REGISTRY: EnrichmentRegistry = {
  // ...existing
  [myEnrichment.id]: myEnrichment,
}
```

## Step 5: Verify

1. `bunx tsc --noEmit` (from `apps/sim`, `NODE_OPTIONS=--max-old-space-size=8192`) and `bunx biome check` on the changed files.
2. In a table → **+ New column → Enrichments** → pick the new enrichment, map its inputs to columns, name the output column(s), Save. Confirm it appears in the catalog with its icon/description.
3. With hosted keys (or a workspace BYOK key) configured for each provider's service, run a row and confirm the cell fills; the dev-server log shows `Enrichment hit { provider }`. A row whose providers all miss completes blank; a row where every provider errored shows an error cell.

## Checklist

- [ ] Each output mapped to a real tool field (verified against the tool's `params`/`outputs`)
- [ ] **Every provider tool has a `hosting` block — ran `/add-hosted-key` for any that didn't**
- [ ] Providers ordered cheapest / most-likely-first; Apollo/LinkedIn not used
- [ ] Enrichment file is client-safe (no `@/tools` import); uses `toolProvider` + shared helpers
- [ ] `buildParams` returns `null` on insufficient inputs; `mapOutput` returns `null` on a miss
- [ ] Registered in `enrichments/registry.ts`
- [ ] tsc + biome clean; created and ran the column end-to-end
