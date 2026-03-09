---
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

## Directory Structure

Create files in `apps/sim/tools/{service}/`:
```
tools/{service}/
├── index.ts      # Barrel export
├── types.ts      # Parameter & response types
└── {action}.ts   # Individual tool files (one per operation)
```

## Tool Configuration Structure

Every tool MUST follow this exact structure:

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

After creating tools, remind the user to:
1. Import tools in `apps/sim/tools/registry.ts`
2. Add to the `tools` object with snake_case keys:
```typescript
import { serviceActionTool } from '@/tools/{service}'

export const tools = {
  // ... existing tools ...
  {service}_{action}: serviceActionTool,
}
```

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
- [ ] All params have explicit `required: true` or `required: false`
- [ ] All params have appropriate `visibility`
- [ ] All nullable response fields use `?? null`
- [ ] All optional outputs have `optional: true`
- [ ] No raw JSON dumps in outputs
- [ ] Types file has all interfaces
- [ ] Index.ts exports all tools

## Final Validation (Required)

After creating all tools, you MUST validate every tool before finishing:

1. **Read every tool file** you created — do not skip any
2. **Cross-reference with the API docs** to verify:
   - All required params are marked `required: true`
   - All optional params are marked `required: false`
   - Param types match the API (string, number, boolean, json)
   - Request URL, method, headers, and body match the API spec
   - `transformResponse` extracts the correct fields from the API response
   - All output fields match what the API actually returns
   - No fields are missing from outputs that the API provides
   - No extra fields are defined in outputs that the API doesn't return
3. **Verify consistency** across tools:
   - Shared types in `types.ts` match all tools that use them
   - Tool IDs in the barrel export match the tool file definitions
   - Error handling is consistent (error checks, meaningful messages)
