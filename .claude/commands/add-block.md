---
description: Create a block configuration for a Sim integration with proper subBlocks, conditions, and tool wiring
argument-hint: <service-name>
---

# Add Block Skill

You are an expert at creating block configurations for Sim. You understand the serializer, subBlock types, conditions, dependsOn, modes, and all UI patterns.

## Your Task

When the user asks you to create a block:
1. Create the block file in `apps/sim/blocks/blocks/{service}.ts`
2. Configure all subBlocks with proper types, conditions, and dependencies
3. Wire up tools correctly

## Block Configuration Structure

```typescript
import { {ServiceName}Icon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const {ServiceName}Block: BlockConfig = {
  type: '{service}',                    // snake_case identifier
  name: '{Service Name}',               // Human readable
  description: 'Brief description',     // One sentence
  longDescription: 'Detailed description for docs',
  docsLink: 'https://docs.sim.ai/tools/{service}',
  category: 'tools',                    // 'tools' | 'blocks' | 'triggers'
  bgColor: '#HEXCOLOR',                 // Brand color
  icon: {ServiceName}Icon,

  // Auth mode
  authMode: AuthMode.OAuth,             // or AuthMode.ApiKey

  subBlocks: [
    // Define all UI fields here
  ],

  tools: {
    access: ['tool_id_1', 'tool_id_2'], // Array of tool IDs this block can use
    config: {
      tool: (params) => `{service}_${params.operation}`,  // Tool selector function
      params: (params) => ({
        // Transform subBlock values to tool params
      }),
    },
  },

  inputs: {
    // Optional: define expected inputs from other blocks
  },

  outputs: {
    // Define outputs available to downstream blocks
  },
}
```

## SubBlock Types Reference

**Critical:** Every subblock `id` must be unique within the block. Duplicate IDs cause conflicts even with different conditions.

### Text Inputs
```typescript
// Single-line input
{ id: 'field', title: 'Label', type: 'short-input', placeholder: '...' }

// Multi-line input
{ id: 'field', title: 'Label', type: 'long-input', placeholder: '...', rows: 6 }

// Password input
{ id: 'apiKey', title: 'API Key', type: 'short-input', password: true }
```

### Selection Inputs
```typescript
// Dropdown (static options)
{
  id: 'operation',
  title: 'Operation',
  type: 'dropdown',
  options: [
    { label: 'Create', id: 'create' },
    { label: 'Update', id: 'update' },
  ],
  value: () => 'create',  // Default value function
}

// Combobox (searchable dropdown)
{
  id: 'field',
  title: 'Label',
  type: 'combobox',
  options: [...],
  searchable: true,
}
```

### Code/JSON Inputs
```typescript
{
  id: 'code',
  title: 'Code',
  type: 'code',
  language: 'javascript',  // 'javascript' | 'json' | 'python'
  placeholder: '// Enter code...',
}
```

### OAuth/Credentials
```typescript
{
  id: 'credential',
  title: 'Account',
  type: 'oauth-input',
  serviceId: '{service}',  // Must match OAuth provider
  placeholder: 'Select account',
  required: true,
}
```

### Selectors (with dynamic options)
```typescript
// Channel selector (Slack, Discord, etc.)
{
  id: 'channel',
  title: 'Channel',
  type: 'channel-selector',
  serviceId: '{service}',
  placeholder: 'Select channel',
  dependsOn: ['credential'],
}

// Project selector (Jira, etc.)
{
  id: 'project',
  title: 'Project',
  type: 'project-selector',
  serviceId: '{service}',
  dependsOn: ['credential'],
}

// File selector (Google Drive, etc.)
{
  id: 'file',
  title: 'File',
  type: 'file-selector',
  serviceId: '{service}',
  mimeType: 'application/pdf',
  dependsOn: ['credential'],
}

// User selector
{
  id: 'user',
  title: 'User',
  type: 'user-selector',
  serviceId: '{service}',
  dependsOn: ['credential'],
}
```

### Other Types
```typescript
// Switch/toggle
{ id: 'enabled', type: 'switch' }

// Slider
{ id: 'temperature', title: 'Temperature', type: 'slider', min: 0, max: 2, step: 0.1 }

// Table (key-value pairs)
{ id: 'headers', title: 'Headers', type: 'table', columns: ['Key', 'Value'] }

// File upload
{
  id: 'files',
  title: 'Attachments',
  type: 'file-upload',
  multiple: true,
  acceptedTypes: 'image/*,application/pdf',
}
```

## File Input Handling

When your block accepts file uploads, use the basic/advanced mode pattern with `normalizeFileInput`.

### Basic/Advanced File Pattern

```typescript
// Basic mode: Visual file upload
{
  id: 'uploadFile',
  title: 'File',
  type: 'file-upload',
  canonicalParamId: 'file',  // Both map to 'file' param
  placeholder: 'Upload file',
  mode: 'basic',
  multiple: false,
  required: true,
  condition: { field: 'operation', value: 'upload' },
},
// Advanced mode: Reference from other blocks
{
  id: 'fileRef',
  title: 'File',
  type: 'short-input',
  canonicalParamId: 'file',  // Both map to 'file' param
  placeholder: 'Reference file (e.g., {{file_block.output}})',
  mode: 'advanced',
  required: true,
  condition: { field: 'operation', value: 'upload' },
},
```

**Critical constraints:**
- `canonicalParamId` must NOT match any subblock's `id` in the same block
- Values are stored under subblock `id`, not `canonicalParamId`

### Normalizing File Input in tools.config

Use `normalizeFileInput` to handle all input variants:

```typescript
import { normalizeFileInput } from '@/blocks/utils'

tools: {
  access: ['service_upload'],
  config: {
    tool: (params) => {
      // Check all field IDs: uploadFile (basic), fileRef (advanced), fileContent (legacy)
      const normalizedFile = normalizeFileInput(
        params.uploadFile || params.fileRef || params.fileContent,
        { single: true }
      )
      if (normalizedFile) {
        params.file = normalizedFile
      }
      return `service_${params.operation}`
    },
  },
}
```

**Why this pattern?**
- Values come through as `params.uploadFile` or `params.fileRef` (the subblock IDs)
- `canonicalParamId` only controls UI/schema mapping, not runtime values
- `normalizeFileInput` handles JSON strings from advanced mode template resolution

### File Input Types in `inputs`

Use `type: 'json'` for file inputs:

```typescript
inputs: {
  uploadFile: { type: 'json', description: 'Uploaded file (UserFile)' },
  fileRef: { type: 'json', description: 'File reference from previous block' },
  // Legacy field for backwards compatibility
  fileContent: { type: 'string', description: 'Legacy: base64 encoded content' },
}
```

### Multiple Files

For multiple file uploads:

```typescript
{
  id: 'attachments',
  title: 'Attachments',
  type: 'file-upload',
  multiple: true,  // Allow multiple files
  maxSize: 25,     // Max size in MB per file
  acceptedTypes: 'image/*,application/pdf,.doc,.docx',
}

// In tools.config:
const normalizedFiles = normalizeFileInput(
  params.attachments || params.attachmentRefs,
  // No { single: true } - returns array
)
if (normalizedFiles) {
  params.files = normalizedFiles
}
```

## Condition Syntax

Controls when a field is shown based on other field values.

### Simple Condition
```typescript
condition: { field: 'operation', value: 'create' }
// Shows when operation === 'create'
```

### Multiple Values (OR)
```typescript
condition: { field: 'operation', value: ['create', 'update'] }
// Shows when operation is 'create' OR 'update'
```

### Negation
```typescript
condition: { field: 'operation', value: 'delete', not: true }
// Shows when operation !== 'delete'
```

### Compound (AND)
```typescript
condition: {
  field: 'operation',
  value: 'send',
  and: {
    field: 'type',
    value: 'dm',
    not: true,
  }
}
// Shows when operation === 'send' AND type !== 'dm'
```

### Complex Example
```typescript
condition: {
  field: 'operation',
  value: ['list', 'search'],
  not: true,
  and: {
    field: 'authMethod',
    value: 'oauth',
  }
}
// Shows when operation NOT in ['list', 'search'] AND authMethod === 'oauth'
```

## DependsOn Pattern

Controls when a field is enabled and when its options are refetched.

### Simple Array (all must be set)
```typescript
dependsOn: ['credential']
// Enabled only when credential has a value
// Options refetch when credential changes

dependsOn: ['credential', 'projectId']
// Enabled only when BOTH have values
```

### Complex (all + any)
```typescript
dependsOn: {
  all: ['authMethod'],           // All must be set
  any: ['credential', 'apiKey']  // At least one must be set
}
// Enabled when authMethod is set AND (credential OR apiKey is set)
```

## Required Pattern

Can be boolean or condition-based.

### Simple Boolean
```typescript
required: true
required: false
```

### Conditional Required
```typescript
required: { field: 'operation', value: 'create' }
// Required only when operation === 'create'

required: { field: 'operation', value: ['create', 'update'] }
// Required when operation is 'create' OR 'update'
```

## Mode Pattern (Basic vs Advanced)

Controls which UI view shows the field.

### Mode Options
- `'basic'` - Only in basic view (default UI)
- `'advanced'` - Only in advanced view
- `'both'` - Both views (default if not specified)
- `'trigger'` - Only in trigger configuration

### canonicalParamId Pattern

Maps multiple UI fields to a single serialized parameter:

```typescript
// Basic mode: Visual selector
{
  id: 'channel',
  title: 'Channel',
  type: 'channel-selector',
  mode: 'basic',
  canonicalParamId: 'channel',  // Both map to 'channel' param
  dependsOn: ['credential'],
}

// Advanced mode: Manual input
{
  id: 'channelId',
  title: 'Channel ID',
  type: 'short-input',
  mode: 'advanced',
  canonicalParamId: 'channel',  // Both map to 'channel' param
  placeholder: 'Enter channel ID manually',
}
```

**How it works:**
- In basic mode: `channel` selector value → `params.channel`
- In advanced mode: `channelId` input value → `params.channel`
- The serializer consolidates based on current mode

**Critical constraints:**
- `canonicalParamId` must NOT match any other subblock's `id` in the same block (causes conflicts)
- `canonicalParamId` must be unique per block (only one basic/advanced pair per canonicalParamId)
- ONLY use `canonicalParamId` to link basic/advanced mode alternatives for the same logical parameter
- Do NOT use it for any other purpose

## WandConfig Pattern

Enables AI-assisted field generation.

```typescript
{
  id: 'query',
  title: 'Query',
  type: 'code',
  language: 'json',
  wandConfig: {
    enabled: true,
    prompt: 'Generate a query based on the user request. Return ONLY the JSON.',
    placeholder: 'Describe what you want to query...',
    generationType: 'json-object',  // Optional: affects AI behavior
    maintainHistory: true,          // Optional: keeps conversation context
  },
}
```

### Generation Types
- `'javascript-function-body'` - JS code generation
- `'json-object'` - Raw JSON (adds "no markdown" instruction)
- `'json-schema'` - JSON Schema definitions
- `'sql-query'` - SQL statements
- `'timestamp'` - Adds current date/time context

## Tools Configuration

**Preferred:** Use tool names directly as dropdown option IDs to avoid switch cases:
```typescript
// Dropdown options use tool IDs directly
options: [
  { label: 'Create', id: 'service_create' },
  { label: 'Read', id: 'service_read' },
]

// Tool selector just returns the operation value
tool: (params) => params.operation,
```

### With Parameter Transformation
```typescript
tools: {
  access: ['service_action'],
  config: {
    tool: (params) => 'service_action',
    params: (params) => ({
      id: params.resourceId,
      data: typeof params.data === 'string' ? JSON.parse(params.data) : params.data,
    }),
  },
}
```

### V2 Versioned Tool Selector
```typescript
import { createVersionedToolSelector } from '@/blocks/utils'

tools: {
  access: [
    'service_create_v2',
    'service_read_v2',
    'service_update_v2',
  ],
  config: {
    tool: createVersionedToolSelector({
      baseToolSelector: (params) => `service_${params.operation}`,
      suffix: '_v2',
      fallbackToolId: 'service_create_v2',
    }),
  },
}
```

## Outputs Definition

**IMPORTANT:** Block outputs have a simpler schema than tool outputs. Block outputs do NOT support:
- `optional: true` - This is only for tool outputs
- `items` property - This is only for tool outputs with array types

Block outputs only support:
- `type` - The data type ('string', 'number', 'boolean', 'json', 'array')
- `description` - Human readable description
- Nested object structure (for complex types)

```typescript
outputs: {
  // Simple outputs
  id: { type: 'string', description: 'Resource ID' },
  success: { type: 'boolean', description: 'Whether operation succeeded' },

  // Use type: 'json' for complex objects or arrays (NOT type: 'array' with items)
  items: { type: 'json', description: 'List of items' },
  metadata: { type: 'json', description: 'Response metadata' },

  // Nested outputs (for structured data)
  user: {
    id: { type: 'string', description: 'User ID' },
    name: { type: 'string', description: 'User name' },
    email: { type: 'string', description: 'User email' },
  },
}
```

## V2 Block Pattern

When creating V2 blocks (alongside legacy V1):

```typescript
// V1 Block - mark as legacy
export const ServiceBlock: BlockConfig = {
  type: 'service',
  name: 'Service (Legacy)',
  hideFromToolbar: true,  // Hide from toolbar
  // ... rest of config
}

// V2 Block - visible, uses V2 tools
export const ServiceV2Block: BlockConfig = {
  type: 'service_v2',
  name: 'Service',              // Clean name
  hideFromToolbar: false,       // Visible
  subBlocks: ServiceBlock.subBlocks,  // Reuse UI
  tools: {
    access: ServiceBlock.tools?.access?.map(id => `${id}_v2`) || [],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: (params) => (ServiceBlock.tools?.config as any)?.tool(params),
        suffix: '_v2',
        fallbackToolId: 'service_default_v2',
      }),
      params: ServiceBlock.tools?.config?.params,
    },
  },
  outputs: {
    // Flat, API-aligned outputs (not wrapped in content/metadata)
  },
}
```

## Registering Blocks

After creating the block, remind the user to:
1. Import in `apps/sim/blocks/registry.ts`
2. Add to the `registry` object (alphabetically):

```typescript
import { ServiceBlock } from '@/blocks/blocks/service'

export const registry: Record<string, BlockConfig> = {
  // ... existing blocks ...
  service: ServiceBlock,
}
```

## Complete Example

```typescript
import { ServiceIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const ServiceBlock: BlockConfig = {
  type: 'service',
  name: 'Service',
  description: 'Integrate with Service API',
  longDescription: 'Full description for documentation...',
  docsLink: 'https://docs.sim.ai/tools/service',
  category: 'tools',
  bgColor: '#FF6B6B',
  icon: ServiceIcon,
  authMode: AuthMode.OAuth,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create', id: 'create' },
        { label: 'Read', id: 'read' },
        { label: 'Update', id: 'update' },
        { label: 'Delete', id: 'delete' },
      ],
      value: () => 'create',
    },
    {
      id: 'credential',
      title: 'Service Account',
      type: 'oauth-input',
      serviceId: 'service',
      placeholder: 'Select account',
      required: true,
    },
    {
      id: 'resourceId',
      title: 'Resource ID',
      type: 'short-input',
      placeholder: 'Enter resource ID',
      condition: { field: 'operation', value: ['read', 'update', 'delete'] },
      required: { field: 'operation', value: ['read', 'update', 'delete'] },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Resource name',
      condition: { field: 'operation', value: ['create', 'update'] },
      required: { field: 'operation', value: 'create' },
    },
  ],

  tools: {
    access: ['service_create', 'service_read', 'service_update', 'service_delete'],
    config: {
      tool: (params) => `service_${params.operation}`,
    },
  },

  outputs: {
    id: { type: 'string', description: 'Resource ID' },
    name: { type: 'string', description: 'Resource name' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
  },
}
```

## Connecting Blocks with Triggers

If the service supports webhooks, connect the block to its triggers.

```typescript
import { getTrigger } from '@/triggers'

export const ServiceBlock: BlockConfig = {
  // ... basic config ...

  triggers: {
    enabled: true,
    available: ['service_event_a', 'service_event_b', 'service_webhook'],
  },

  subBlocks: [
    // Tool subBlocks first...
    { id: 'operation', /* ... */ },

    // Then spread trigger subBlocks
    ...getTrigger('service_event_a').subBlocks,
    ...getTrigger('service_event_b').subBlocks,
    ...getTrigger('service_webhook').subBlocks,
  ],
}
```

See the `/add-trigger` skill for creating triggers.

## Icon Requirement

If the icon doesn't already exist in `@/components/icons.tsx`, **do NOT search for it yourself**. After completing the block, ask the user to provide the SVG:

```
The block is complete, but I need an icon for {Service}.
Please provide the SVG and I'll convert it to a React component.

You can usually find this in the service's brand/press kit page, or copy it from their website.
```

## Checklist Before Finishing

- [ ] All subBlocks have `id`, `title` (except switch), and `type`
- [ ] Conditions use correct syntax (field, value, not, and)
- [ ] DependsOn set for fields that need other values
- [ ] Required fields marked correctly (boolean or condition)
- [ ] OAuth inputs have correct `serviceId`
- [ ] Tools.access lists all tool IDs
- [ ] Tools.config.tool returns correct tool ID
- [ ] Outputs match tool outputs
- [ ] Block registered in registry.ts
- [ ] If icon missing: asked user to provide SVG
- [ ] If triggers exist: `triggers` config set, trigger subBlocks spread
