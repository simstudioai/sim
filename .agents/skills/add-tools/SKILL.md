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
`request.internal`, add the retired `directExecution` property, import a route module, or create an API route merely to normalize files,
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
    // Hidden params (system-injected, only use hidden for oauth accessToken)
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

### Reserved Parameter Names

The shared transport reads three names off `params` for its own purposes, before your `request`
config ever sees them (`apps/sim/tools/request-transport.ts`):

| Param | Read at | What the transport does with it |
|---|---|---|
| `timeout` | `request-transport.ts:191` | Outbound HTTP deadline **in milliseconds**, clamped to `getMaxExecutionTimeout()` |
| `proxyUrl` | `request-transport.ts:198` | Egress proxy URL for the request |
| `method` | `request-transport.ts:167` | Overrides a *static* `request.method` string (a `method` **function** wins over it) |

Never declare a user-facing param with one of these names unless it means exactly what the transport
means. The collision is silent and unit-blind: `apps/sim/tools/daytona/execute_command.ts:49`
declares `timeout` as *"Timeout in seconds (defaults to 10 seconds)"*, so a documented 10-second
sandbox timeout aborts the HTTP call after **10 milliseconds**.

Give the param a distinct Sim-side name (`timeoutSeconds`, `executionTimeout`, `httpMethod`) and emit
the provider's spelling from `request.body` or `request.url`. Renaming the tool param is not enough
on its own if a block already sends the reserved key — see **Omitting a key from `tools.config.params`
does not drop it** in the `add-block` skill.

## Resolved Secrets and Provenance Boundaries

- Leave ordinary external API inputs and third-party results unchanged. Add provenance handling only
  when an exact field is proven to cross a Sim model, durable-storage, or internal-execution boundary.
- Project AI-consumed text/structured fields with the smallest exact model-input selector:
  `request.modelInput` for an external request or `operation.modelInput` for an in-process operation.
- Treat URLs, domains, resource IDs, and control fields as ordinary request values unless the exact
  field is proven model-visible. For serialized external model content, project the serialized
  top-level param through `request.modelInput` before the existing formatter parses it; do not add a
  separate hard-rejection mechanism.
- For in-process operations, use `operation.modelInput` for actual inline/raw model bytes or
  `operation.secretProvenance` for durable writes and execution handoffs. Do not treat a storage key,
  path, signed URL, or remote URL as provenance for fetched bytes; authorize tracked stored bytes at
  the owning model-egress boundary. Validate the exact selection and trusted scope, then import or
  propagate provenance at the receiving operation boundary.
- Never substitute secret plaintext into source, serialize plaintext provenance, hand-roll private
  headers, or blanket-sanitize tool results.
- Add focused tests for named projection, identical unproven public text, malformed/incomplete
  metadata, metadata stripping, scope isolation, and legacy compatibility where applicable.

## Path Parameters: Reject Traversal, Never Just Encode

`encodeURIComponent` does **not** stop path traversal. `.` and `..` are *unreserved* characters, so
they survive encoding verbatim, and the WHATWG URL parser that `fetch` uses removes dot segments
**after** decoding — the percent-encoded spellings included:

```
new URL('https://x/v1/a/b/..').pathname     // => '/v1/a/'
new URL('https://x/v1/a/b/%2e%2e').pathname // => '/v1/a/'   (still removed)
```

A removed segment pops a path segment on a fixed host with the workspace's bearer token still
attached, including on DELETE routes. Path IDs are typically `visibility: 'user-or-llm'`, so prompt
injection controls them. Rejection is the only mechanism that closes this; the module note at the top
of `apps/sim/tools/url-path.ts` states the rule in full.

Never interpolate a param into a request path yourself. Use the helpers in `apps/sim/tools/url-path.ts`:

| Helper | Use when the parameter is | Trims? |
|---|---|---|
| `safeUrlPathSegment` | **One opaque id** — `user_abc`, `12345`, a repo name. Rejects any `/` or `\`: a separator means the caller passed something other than what the parameter addresses. | Yes — surrounding whitespace on a copy-pasted id is transport noise. |
| `safeUrlPath` | **A real slash-delimited path** the provider documents as such (GitHub `path`, `branch`, `ref`). Splits on `/`, rejects any `.`/`..` segment, percent-encodes each segment, keeps the separators. | **No** — a leading or trailing space is a legal git filename, so trimming would read, update, or *delete* a different file. |
| `safeEncodedUrlPathSegment` | **One value that may itself contain `/`** but the provider reads as a single parameter (a GitHub label `area/api` in `DELETE .../labels/{name}`). Preserves the separator as `%2F`. | Yes. |

Prefer `safeUrlPathSegment`. Reach for the other two only when the provider documents the parameter
as slash-bearing — never to make a separator stop erroring on a single-segment id.

GitHub is the worked example, and it settles the case that looks ambiguous: `branch`, `ref`, `base`,
and `head` take **`safeUrlPath`**, not `safeEncodedUrlPathSegment`. `GET /repos/{o}/{r}/branches/{branch}`
is greedy on its final parameter, so a branch named `feature/api` is addressed as
`/branches/feature/api` with a real separator — emitting `%2F` there would 404. The `%2F` form is for
a parameter the provider reads as one value *and* does not treat as greedy, such as a label name in
`DELETE .../labels/{name}`. Read the provider's route, not the value's shape.

**Availability.** `safeUrlPathSegment` is on `staging`. The rest of this module — `safeUrlPath`,
`safeEncodedUrlPathSegment`, `strictUrlPathSegment`, `strictEncodedUrlPathSegment` — and the
`path_safety.test.ts` suites cited throughout arrive with the path-safety sweep. Check what
`apps/sim/tools/url-path.ts` and `apps/sim/tools/__tests__/path-safety.ts` actually export in your
checkout; if a helper you need is absent, add it there rather than hand-rolling a local encoder.
Citations below name **module and symbol** rather than a line, because those files are still moving.

### Never let a new guard rescue a request that used to fail

If a parameter you are now routing through a helper previously went out raw or through a bare
`encodeURIComponent`, the helper's trimming is a **behaviour change**, not a tightening: a padded
value that used to 404 now names a real resource. On a DELETE, a cancel, or a revoke that is a
destructive action the caller never asked for.

For a newly-trimmed identifier on an irreversible request, use `strictUrlPathSegment` in
`apps/sim/tools/url-path.ts` — `safeUrlPathSegment` plus a refusal of surrounding whitespace —
rather than trimming (`strictEncodedUrlPathSegment` is its `%2F`-preserving counterpart). Identifiers that were already trimmed before your change keep
plain `safeUrlPathSegment`. The full rule, its two confirmed instances, and how to scope the check are
in **A hardening change must not turn a failing request into a succeeding one** in
`.agents/skills/validate-integration/SKILL.md`.

Note the matching asymmetry inside `safeUrlPath`: it rejects only a **truly empty** path component,
never a whitespace-only one. Git tracks a file and a directory whose entire name
is spaces, and the URL parser never removes `%20%20%20` the way it removes a dot segment — so
rejecting it has no security value and breaks a legitimate path. `safeUrlPathSegment` still rejects an
all-whitespace value, because it trims opaque ids first.

### `params.x?.trim()` guards `undefined`, not the type

A param's declared `type: 'string'` is enforced nowhere between the LLM tool call — or a
`<Block.output>` reference resolved out of stored workflow state — and your URL builder. A
numeric-looking id (a Vercel `deploymentId`, a Daytona `sandboxId`) arrives as a JSON **number** and
stays one, so `params.id?.trim()` throws a bare `TypeError: params.id.trim is not a function` naming
neither the tool nor the parameter.

`toGuardedString` (`apps/sim/tools/url-path.ts:98`) is why the helpers do not have this problem: it
accepts `string`, `number`, and `bigint`, rejects everything else **by parameter name**, and refuses
number spellings whose decimal text is not the id the caller meant. Route path params through the
helpers instead of hand-rolling an optional-chained `trim()`.

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

Only use bare `type: 'json'` without `properties` when the shape is truly dynamic or unknown.

If the response shape is unknown because the docs do not provide it, you MUST tell the user and stop. Unknown is not the same as dynamic. Never guess outputs.

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

## Naming Convention

All tool IDs MUST use `snake_case`: `{service}_{action}` (e.g., `x_create_tweet`, `slack_send_message`). Never use camelCase or PascalCase for tool IDs.

## Checklist Before Finishing

- [ ] All tool IDs use snake_case
- [ ] Chose exactly one boundary: registered `InternalToolConfig.operation` or absolute external
      HTTP(S) `ToolConfig.request`
- [ ] No tool request points to `/api/...`, constructs a URL back to Sim, or declares
      `request.internal`
- [ ] No tool declares `directExecution`; in-process work uses a registered operation
- [ ] All params have explicit `required: true` or `required: false`
- [ ] All params have appropriate `visibility`
- [ ] No param is named `timeout`, `proxyUrl`, or `method` unless it means what the transport means
- [ ] Every param interpolated into a request path goes through a `tools/url-path.ts` helper
- [ ] No newly-guarded parameter on a destructive request turns a previously failing call into a
      succeeding one — those use `strictUrlPathSegment`, not `safeUrlPathSegment`
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

After creating all tools, you MUST validate every tool before finishing:

1. **Read every tool file** you created — do not skip any
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
