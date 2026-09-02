---
name: add-tools
description: Create tool configurations for a Sim integration by reading API docs
argument-hint: <service-name> [api-docs-url]
---

# Add Tools Skill

You are an expert at creating tool configurations for Sim integrations. Your job is to read API documentation and create properly structured tool files.

## Your Task

When the user asks you to create tools for a service:
1. Use Context7 or WebFetch to read the service's API documentation
2. Create the tools directory structure
3. Generate properly typed tool configurations

## Hard Rule: No Guessed Response Schemas

If the docs do not clearly show the response JSON for a tool, you MUST tell the user exactly which outputs are unknown and stop short of guessing.

- Do NOT invent response field names
- Do NOT infer nested paths from nearby endpoints
- Do NOT guess array item shapes
- Do NOT write `transformResponse` against unverified payloads

If the response shape is unknown, do one of these instead:
1. Ask the user for sample responses
2. Ask the user for test credentials so you can verify live responses
3. Implement only the endpoints whose outputs are documented
4. Leave the tool unimplemented and explicitly say why

## Directory Structure

Create files in `apps/sim/tools/{service}/`:
```
tools/{service}/
├── index.ts      # Barrel export
├── types.ts      # Parameter & response types
└── {action}.ts   # Individual tool files (one per operation)
```

## Tool Configuration Structure

### Choose the execution boundary first

Every tool must use exactly one of these configurations:

- **In-process operation (preferred):** use `InternalToolConfig` when the executor and the
  implementation run in the same Sim process/trust/runtime plane. Materialize typed
  `operation.input`, implement the handler under `apps/sim/lib/internal/{service}/execute-tool.ts`,
  and register every tool ID in `apps/sim/lib/internal/tool-operations/registry.server.ts`.
- **External provider request:** use `ToolConfig.request` only when the URL is an absolute external
  HTTP(S) provider endpoint.

Never set a tool URL to `/api/...`, construct an absolute URL back to Sim, declare
`request.internal`, add a `directExecution` property (it fails `bun run check:tool-request-boundary`), import a route module, or create an API route merely to normalize files,
authorize access, or reuse server code. A real browser/API route may remain as a thin adapter, but
the route and the tool must call the same operation directly. A true cross-process/capability
boundary uses an explicit server client and is not disguised as a tool self-hop.

For protected Sim resources, the internal handler calls the domain's authorized application use
case with trusted execution context; use the `migrate-application-operation` skill.

### External provider request

Use this structure only for an absolute external provider API:

```typescript
import type { {ServiceName}{Action}Params } from '@/tools/{service}/types'
import type { ToolConfig } from '@/tools/types'

interface {ServiceName}{Action}Response {
  success: boolean
  output: {
    // Define output structure here
  }
}

export const {serviceName}{Action}Tool: ToolConfig<
  {ServiceName}{Action}Params,
  {ServiceName}{Action}Response
> = {
  id: '{service}_{action}',           // snake_case, matches tool name
  name: '{Service} {Action}',         // Human readable
  description: 'Brief description',   // One sentence
  version: '1.0.0',

  // OAuth config (if service uses OAuth)
  oauth: {
    required: true,
    provider: '{service}',            // Must match OAuth provider ID
  },

  params: {
    // Hidden params (system-injected, e.g. the OAuth accessToken)
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    // User-only params (credentials, api key, IDs user must provide)
    someId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The ID of the resource',
    },
    // User-or-LLM params (everything else, can be provided by user OR computed by LLM)
    query: {
      type: 'string',
      required: false,                // Use false for optional
      visibility: 'user-or-llm',
      description: 'Search query',
    },
  },

  request: {
    url: (params) => `https://api.service.com/v1/resource/${params.id}`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      // Request body - only for POST/PUT/PATCH
      // Trim ID fields to prevent copy-paste whitespace errors:
      // userId: params.userId?.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        // Map API response to output
        // Use ?? null for nullable fields
        // Use ?? [] for optional arrays
      },
    }
  },

  outputs: {
    // Define each output field
  },
}
```

### In-process operation

```typescript
import type { InternalToolConfig } from '@/tools/types'

export const {serviceName}{Action}Tool: InternalToolConfig<
  {ServiceName}{Action}Params,
  {ServiceName}{Action}Response
> = {
  id: '{service}_{action}',
  name: '{Service} {Action}',
  description: 'Brief description',
  version: '1.0.0',
  params: {
    // Same canonical metadata as an external tool.
  },
  operation: {
    input: (params) => ({
      // Map resolved tool params into the typed semantic operation input.
    }),
  },
  outputs: {
    // Define each output field.
  },
}
```

The registered handler accepts `InternalToolOperationCall`, validates `request.input`, uses only
trusted `request.context` for authority, forwards `request.signal`, and returns the same bounded
`Response` contract expected by the tool executor. It has no URL, method, request headers, fetch
fallback, or caller-controlled `_context` authority.

## Critical Rules for Parameters

### Visibility Options
- `'hidden'` - System-injected (OAuth tokens, internal params). User never sees.
- `'user-only'` - User must provide (credentials, api keys, account-specific IDs)
- `'user-or-llm'` - User provides OR LLM can compute (search queries, content, filters, most fall into this category)

### Parameter Types
- `'string'` - Text values
- `'number'` - Numeric values
- `'boolean'` - True/false
- `'json'` - Complex objects (NOT 'object', use 'json')
- `'file'` - Single file
- `'file[]'` - Multiple files

### Required vs Optional
- Always explicitly set `required: true` or `required: false`
- Optional params should have `required: false`

## Resolved Secrets and Provenance Boundaries

Classify every request field before implementing the tool.

This is opt-in, not a blanket integration migration. Add a model-input declaration only when the
service's official documentation or an unambiguous local execution path proves that the exact
field is consumed by an AI model. If that cannot be established, preserve existing tool behavior
and leave the field unannotated.

- **Ordinary provider/API input:** leave it unchanged. Explicit `{{...}}` references resolve and are
  sent with their normal request semantics. A URL, domain, resource ID, control field, or opaque
  payload is not model-visible merely because the provider is AI-backed or may process the
  referenced resource later.
- **Text or structured content consumed by an AI model:** declare `request.modelInput` for an
  external provider request or `operation.modelInput` for an in-process operation, with
  `mode: 'project'` and select only the exact model-visible fields. The shared executor replaces
  activated Sim secrets with canonical `{{NAME}}` labels before request formatting. For nested or
  JSON-string fields, use a small shared selector plus `applyProjected`; verify that selecting the
  rebuilt params reproduces the projected selection.
- **Serialized model content sent directly to an external provider:** include the serialized
  top-level param in `request.modelInput`. Project the private copy before the existing request
  formatter parses it; keep formatter behavior deterministic when a whole-value placeholder is not
  valid in the serialized grammar. Do not introduce a second hard-rejection path.
- **Opaque model input owned by an in-process operation** such as inline audio, image, video, or
  document bytes: add `privateProvenance` to the operation model-input declaration, or use
  `mode: 'private-provenance'` when there is no textual projection. Do not select storage keys,
  paths, signed URLs, or ordinary remote URLs as byte provenance; the owning operation must
  authorize stored bytes independently at model egress. The operation must call
  `validateOpaqueModelInputProvenance` before downloading or sending content to the model and must
  apply the workspace-file provenance guard before reading a persisted workspace file.
- **Sim-owned durable storage or internal execution handoff** that can later enter a workflow/model
  (table cells, Agent memory, knowledge documents/chunks, workspace-file contents, or child-workflow
  input): transport encrypted field-scoped provenance with `operation.secretProvenance`. The
  operation validates the exact selection and trusted scope, then persists, imports, or propagates
  it at the owning boundary. Preserve shared legacy behavior for rows/files whose provenance marker
  is `NULL`; never invent a tool-local migration rule.

Hard rules:

- Never substitute secret plaintext into source or serialize plaintext provenance.
- Never hand-roll private provenance headers/envelopes; the shared `executeTool` boundary owns
  transport and strips private metadata from functional results.
- Never attach private provenance to an external URL. Project proven
  model-visible external fields with `request.modelInput`; otherwise preserve ordinary request
  semantics. Use a registered in-process operation when encrypted provenance must cross the
  boundary.
- Never sanitize arbitrary third-party tool results. Projection applies only to secrets activated
  by Sim's resolved-secret provenance for that execution/tool call.
- Do not add provenance merely because a value is persisted, returned by a tool, or appears in a
  filename. Require a concrete Sim `{{...}}` resolution path and a later model/log boundary. If an
  unsupported field can resolve a secret but does not justify durable tracking (for example a
  `file_write` path), reject it at that exact ingress.
- At diagnostic boundaries, project only values carrying execution-scoped provenance. Ordinary
  provider responses, filenames, URLs, and errors remain unchanged when Sim did not resolve a
  secret into them.

Add focused tests covering named projection, ordinary identical text without provenance, nested and
serialized shape handling, unchanged ordinary external inputs, malformed/incomplete private metadata
failing closed, headerless legacy requests, and absence of private metadata in the public tool result.
For durable sinks, also cover legacy `NULL` markers, exact-empty new writes, tracked secret writes,
stale/missing sidecars, and scope isolation.

## Critical Rules for Outputs

### Output Types
- `'string'`, `'number'`, `'boolean'` - Primitives
- `'json'` - Complex objects (use this, NOT 'object')
- `'array'` - Arrays with `items` property
- `'object'` - Objects with `properties` property

### Optional Outputs
Add `optional: true` for fields that may not exist in the response:
```typescript
closedAt: {
  type: 'string',
  description: 'When the issue was closed',
  optional: true,
},
```

### Typed JSON Outputs

When using `type: 'json'` and you know the object shape in advance, **always define the inner structure** using `properties` so downstream consumers know what fields are available:

```typescript
// BAD: Opaque json with no info about what's inside
metadata: {
  type: 'json',
  description: 'Response metadata',
},

// GOOD: Define the known properties
metadata: {
  type: 'json',
  description: 'Response metadata',
  properties: {
    id: { type: 'string', description: 'Unique ID' },
    status: { type: 'string', description: 'Current status' },
    count: { type: 'number', description: 'Total count' },
  },
},
```

For arrays of objects, define the item structure:
```typescript
items: {
  type: 'array',
  description: 'List of items',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Item ID' },
      name: { type: 'string', description: 'Item name' },
    },
  },
},
```

Only use bare `type: 'json'` without `properties` when the shape is truly dynamic. Unknown is not the same as dynamic — see the Hard Rule above.

## Critical Rules for transformResponse

### Handle Nullable Fields
ALWAYS use `?? null` for fields that may be undefined:
```typescript
transformResponse: async (response: Response) => {
  const data = await response.json()
  return {
    success: true,
    output: {
      id: data.id,
      title: data.title,
      body: data.body ?? null,           // May be undefined
      assignee: data.assignee ?? null,   // May be undefined
      labels: data.labels ?? [],         // Default to empty array
      closedAt: data.closed_at ?? null,  // May be undefined
    },
  }
}
```

### Never Output Raw JSON Dumps
DON'T do this:
```typescript
output: {
  data: data,  // BAD - raw JSON dump
}
```

DO this instead - extract meaningful fields:
```typescript
output: {
  id: data.id,
  name: data.name,
  status: data.status,
  metadata: {
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  },
}
```

## Types File Pattern

Create `types.ts` with interfaces for all params and responses:

```typescript
import type { ToolResponse } from '@/tools/types'

// Parameter interfaces
export interface {Service}{Action}Params {
  accessToken: string
  requiredField: string
  optionalField?: string
}

// Response interfaces (extend ToolResponse)
export interface {Service}{Action}Response extends ToolResponse {
  output: {
    field1: string
    field2: number
    optionalField?: string | null
  }
}
```

## Index.ts Barrel Export Pattern

```typescript
// Export all tools
export { serviceTool1 } from './{action1}'
export { serviceTool2 } from './{action2}'

// Export types
export * from './types'
```

## Registering Tools

After creating tools:
1. Import tools in `apps/sim/tools/registry.ts`
2. Add to the `tools` object with snake_case keys (alphabetically):
```typescript
import { serviceActionTool } from '@/tools/{service}'

export const tools = {
  // ... existing tools ...
  {service}_{action}: serviceActionTool,
}
```

3. Regenerate the tool metadata artifacts:

```bash
bun run tool-metadata:generate
```

Client code reads a tool's `params`/`outputs` from generated metadata rather than
importing the registry, so a tool you add, change or remove is invisible to the UI until
these are regenerated — and CI fails on stale artifacts. Commit the result. See
`.agents/skills/tool-registry-boundary/SKILL.md`.

## Wiring Tools into the Block (Required)

After registering in `tools/registry.ts`, you MUST also update the block definition at `apps/sim/blocks/blocks/{service}.ts`. This is not optional — tools are only usable from the UI if they are wired into the block.

### 1. Add to `tools.access`

```typescript
tools: {
  access: [
    // existing tools...
    'service_new_action',   // Add every new tool ID here
  ],
  config: { ... }
}
```

### 2. Add operation dropdown options

If the block uses an operation dropdown, add an option for each new tool:

```typescript
{
  id: 'operation',
  type: 'dropdown',
  options: [
    // existing options...
    { label: 'New Action', id: 'new_action' },   // id maps to what tools.config.tool returns
  ],
}
```

### 3. Add subBlocks for new tool params

For each new tool, add subBlocks covering all its required params (and optional ones where useful). Apply `condition` to show them only for the right operation, and mark required params with `required`:

```typescript
// Required param for new_action
{
  id: 'someParam',
  title: 'Some Param',
  type: 'short-input',
  placeholder: 'e.g., value',
  condition: { field: 'operation', value: 'new_action' },
  required: { field: 'operation', value: 'new_action' },
},
// Optional param — put in advanced mode
{
  id: 'optionalParam',
  title: 'Optional Param',
  type: 'short-input',
  condition: { field: 'operation', value: 'new_action' },
  mode: 'advanced',
},
```

### 4. Update `tools.config.tool`

Ensure the tool selector returns the correct tool ID for every new operation. The simplest pattern:

```typescript
tool: (params) => `service_${params.operation}`,
// If operation dropdown IDs already match tool IDs, this requires no change.
```

If the dropdown IDs differ from tool IDs, add explicit mappings:

```typescript
tool: (params) => {
  const map: Record<string, string> = {
    new_action: 'service_new_action',
    // ...
  }
  return map[params.operation] ?? `service_${params.operation}`
},
```

### 5. Update `tools.config.params`

Add any type coercions needed for new params (runs at execution time, after variable resolution):

```typescript
params: (params) => {
  const result: Record<string, unknown> = {}
  if (params.limit != null && params.limit !== '') result.limit = Number(params.limit)
  if (params.newParamName) result.toolParamName = params.newParamName  // rename if IDs differ
  return result
},
```

### 6. Add new outputs

Add any new fields returned by the new tools to the block `outputs`:

```typescript
outputs: {
  // existing outputs...
  newField: { type: 'string', description: 'Description of new field' },
}
```

### 7. Add new inputs

Add new subBlock param IDs to the block `inputs` section:

```typescript
inputs: {
  // existing inputs...
  someParam: { type: 'string', description: 'Param description' },
  optionalParam: { type: 'string', description: 'Optional param description' },
}
```

### Block wiring checklist

- [ ] New tool IDs added to `tools.access`
- [ ] Operation dropdown has an option for each new tool
- [ ] SubBlocks cover all required params for each new tool
- [ ] SubBlocks have correct `condition` (only show for the right operation)
- [ ] Optional/rarely-used params set to `mode: 'advanced'`
- [ ] `tools.config.tool` returns correct ID for every new operation
- [ ] `tools.config.params` handles any ID remapping or type coercions
- [ ] New outputs added to block `outputs`
- [ ] New params added to block `inputs`

## V2 Tool Pattern

If creating V2 tools (API-aligned outputs), use `_v2` suffix:
- Tool ID: `{service}_{action}_v2`
- Variable name: `{action}V2Tool`
- Version: `'2.0.0'`
- Outputs: Flat, API-aligned (no content/metadata wrapper)

## Checklist Before Finishing

- [ ] All tool IDs use snake_case
- [ ] Chose exactly one boundary: registered `InternalToolConfig.operation` or absolute external
      HTTP(S) `ToolConfig.request`
- [ ] No tool request points to `/api/...`, constructs a URL back to Sim, or declares
      `request.internal`
- [ ] No tool declares `directExecution`; in-process work uses a registered operation
- [ ] All params have explicit `required: true` or `required: false`
- [ ] All params have appropriate `visibility`
- [ ] All nullable response fields use `?? null`
- [ ] All optional outputs have `optional: true`
- [ ] No raw JSON dumps in outputs
- [ ] Types file has all interfaces
- [ ] Index.ts exports all tools and re-exports types (`export * from './types'`)
- [ ] Tools registered in `tools/registry.ts`
- [ ] `bun run tool-metadata:generate` run and the regenerated artifacts committed
- [ ] `bun run scripts/generate-docs.ts` run and the refreshed docs committed — the integration's
      docs page is rendered from each tool's description, params, and outputs, and CI's
      `bun run docs:check` fails on stale pages
- [ ] Block wired: `tools.access`, dropdown options, subBlocks, `tools.config`, outputs, inputs
- [ ] Model, durable-storage, and internal-execution boundaries use the shared provenance mechanisms
      only where a concrete Sim `{{...}}` resolution path requires them
- [ ] Ordinary third-party inputs/results remain unchanged and private metadata never leaves Sim

## Final Validation (Required)

Before finishing, validate each tool file against the API docs:

1. **Re-read each tool file** you created
2. **Cross-reference with the API docs** to verify:
   - All required params are marked `required: true`
   - All optional params are marked `required: false`
   - Param types match the API (string, number, boolean, json)
   - For external tools, request URL, method, headers, and body match the provider API spec
   - For internal tools, `operation.input` matches the handler schema and the handler is registered
     with no HTTP fallback
   - `transformResponse` extracts the correct fields from the API response
   - All output fields match what the API actually returns
   - No fields are missing from outputs that the API provides
   - No extra fields are defined in outputs that the API doesn't return
   - Every output field and JSON path is backed by docs or live-verified sample responses
3. **Verify consistency** across tools:
   - Shared types in `types.ts` match all tools that use them
   - Tool IDs in the barrel export match the tool file definitions
   - Error handling is consistent (error checks, meaningful messages)
4. **If any response schema is still unknown**, explicitly tell the user instead of guessing
