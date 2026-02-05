---
description: Add a complete integration to Sim (tools, block, icon, registration)
argument-hint: <service-name> [api-docs-url]
---

# Add Integration Skill

You are an expert at adding complete integrations to Sim. This skill orchestrates the full process of adding a new service integration.

## Overview

Adding an integration involves these steps in order:
1. **Research** - Read the service's API documentation
2. **Create Tools** - Build tool configurations for each API operation
3. **Create Block** - Build the block UI configuration
4. **Add Icon** - Add the service's brand icon
5. **Create Triggers** (optional) - If the service supports webhooks
6. **Register** - Register tools, block, and triggers in their registries
7. **Generate Docs** - Run the docs generation script

## Step 1: Research the API

Before writing any code:
1. Use Context7 to find official documentation: `mcp__plugin_context7_context7__resolve-library-id`
2. Or use WebFetch to read API docs directly
3. Identify:
   - Authentication method (OAuth, API Key, both)
   - Available operations (CRUD, search, etc.)
   - Required vs optional parameters
   - Response structures

## Step 2: Create Tools

### Directory Structure
```
apps/sim/tools/{service}/
├── index.ts          # Barrel exports
├── types.ts          # TypeScript interfaces
├── {action1}.ts      # Tool for action 1
├── {action2}.ts      # Tool for action 2
└── ...
```

### Key Patterns

**types.ts:**
```typescript
import type { ToolResponse } from '@/tools/types'

export interface {Service}{Action}Params {
  accessToken: string      // For OAuth services
  // OR
  apiKey: string          // For API key services

  requiredParam: string
  optionalParam?: string
}

export interface {Service}Response extends ToolResponse {
  output: {
    // Define output structure
  }
}
```

**Tool file pattern:**
```typescript
export const {service}{Action}Tool: ToolConfig<Params, Response> = {
  id: '{service}_{action}',
  name: '{Service} {Action}',
  description: '...',
  version: '1.0.0',

  oauth: { required: true, provider: '{service}' },  // If OAuth

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden', description: '...' },
    // ... other params
  },

  request: { url, method, headers, body },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        field: data.field ?? null,  // Always handle nullables
      },
    }
  },

  outputs: { /* ... */ },
}
```

### Critical Rules
- `visibility: 'hidden'` for OAuth tokens
- `visibility: 'user-only'` for API keys and user credentials
- `visibility: 'user-or-llm'` for operation parameters
- Always use `?? null` for nullable API response fields
- Always use `?? []` for optional array fields
- Set `optional: true` for outputs that may not exist
- Never output raw JSON dumps - extract meaningful fields

## Step 3: Create Block

### File Location
`apps/sim/blocks/blocks/{service}.ts`

### Block Structure
```typescript
import { {Service}Icon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const {Service}Block: BlockConfig = {
  type: '{service}',
  name: '{Service}',
  description: '...',
  longDescription: '...',
  docsLink: 'https://docs.sim.ai/tools/{service}',
  category: 'tools',
  bgColor: '#HEXCOLOR',
  icon: {Service}Icon,
  authMode: AuthMode.OAuth,  // or AuthMode.ApiKey

  subBlocks: [
    // Operation dropdown
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Operation 1', id: 'action1' },
        { label: 'Operation 2', id: 'action2' },
      ],
      value: () => 'action1',
    },
    // Credential field
    {
      id: 'credential',
      title: '{Service} Account',
      type: 'oauth-input',
      serviceId: '{service}',
      required: true,
    },
    // Conditional fields per operation
    // ...
  ],

  tools: {
    access: ['{service}_action1', '{service}_action2'],
    config: {
      tool: (params) => `{service}_${params.operation}`,
    },
  },

  outputs: { /* ... */ },
}
```

### Key SubBlock Patterns

**Condition-based visibility:**
```typescript
{
  id: 'resourceId',
  title: 'Resource ID',
  type: 'short-input',
  condition: { field: 'operation', value: ['read', 'update', 'delete'] },
  required: { field: 'operation', value: ['read', 'update', 'delete'] },
}
```

**DependsOn for cascading selectors:**
```typescript
{
  id: 'project',
  type: 'project-selector',
  dependsOn: ['credential'],
},
{
  id: 'issue',
  type: 'file-selector',
  dependsOn: ['credential', 'project'],
}
```

**Basic/Advanced mode for dual UX:**
```typescript
// Basic: Visual selector
{
  id: 'channel',
  type: 'channel-selector',
  mode: 'basic',
  canonicalParamId: 'channel',
  dependsOn: ['credential'],
},
// Advanced: Manual input
{
  id: 'channelId',
  type: 'short-input',
  mode: 'advanced',
  canonicalParamId: 'channel',
}
```

**Critical Canonical Param Rules:**
- `canonicalParamId` must NOT match any subblock's `id` in the block
- `canonicalParamId` must be unique per operation/condition context
- Only use `canonicalParamId` to link basic/advanced alternatives for the same logical parameter
- `mode` only controls UI visibility, NOT serialization. Without `canonicalParamId`, both basic and advanced field values would be sent
- Every subblock `id` must be unique within the block. Duplicate IDs cause conflicts even with different conditions
- **Required consistency:** If one subblock in a canonical group has `required: true`, ALL subblocks in that group must have `required: true` (prevents bypassing validation by switching modes)
- **Inputs section:** Must list canonical param IDs (e.g., `fileId`), NOT raw subblock IDs (e.g., `fileSelector`, `manualFileId`)
- **Params function:** Must use canonical param IDs, NOT raw subblock IDs (raw IDs are deleted after canonical transformation)

## Step 4: Add Icon

### File Location
`apps/sim/components/icons.tsx`

### Pattern
```typescript
export function {Service}Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* SVG paths from user-provided SVG */}
    </svg>
  )
}
```

### Getting Icons
**Do NOT search for icons yourself.** At the end of implementation, ask the user to provide the SVG:

```
I've completed the integration. Before I can add the icon, please provide the SVG for {Service}.
You can usually find this in the service's brand/press kit page, or copy it from their website.

Paste the SVG code here and I'll convert it to a React component.
```

Once the user provides the SVG:
1. Extract the SVG paths/content
2. Create a React component that spreads props
3. Ensure viewBox is preserved from the original SVG

## Step 5: Create Triggers (Optional)

If the service supports webhooks, create triggers using the generic `buildTriggerSubBlocks` helper.

### Directory Structure
```
apps/sim/triggers/{service}/
├── index.ts      # Barrel exports
├── utils.ts      # Trigger options, setup instructions, extra fields
├── {event_a}.ts  # Primary trigger (includes dropdown)
├── {event_b}.ts  # Secondary triggers (no dropdown)
└── webhook.ts    # Generic webhook (optional)
```

### Key Pattern

```typescript
import { buildTriggerSubBlocks } from '@/triggers'
import { {service}TriggerOptions, {service}SetupInstructions, build{Service}ExtraFields } from './utils'

// Primary trigger - includeDropdown: true
export const {service}EventATrigger: TriggerConfig = {
  id: '{service}_event_a',
  subBlocks: buildTriggerSubBlocks({
    triggerId: '{service}_event_a',
    triggerOptions: {service}TriggerOptions,
    includeDropdown: true,  // Only for primary trigger!
    setupInstructions: {service}SetupInstructions('Event A'),
    extraFields: build{Service}ExtraFields('{service}_event_a'),
  }),
  // ...
}

// Secondary triggers - no dropdown
export const {service}EventBTrigger: TriggerConfig = {
  id: '{service}_event_b',
  subBlocks: buildTriggerSubBlocks({
    triggerId: '{service}_event_b',
    triggerOptions: {service}TriggerOptions,
    // No includeDropdown!
    setupInstructions: {service}SetupInstructions('Event B'),
    extraFields: build{Service}ExtraFields('{service}_event_b'),
  }),
  // ...
}
```

### Connect to Block
```typescript
import { getTrigger } from '@/triggers'

export const {Service}Block: BlockConfig = {
  triggers: {
    enabled: true,
    available: ['{service}_event_a', '{service}_event_b'],
  },
  subBlocks: [
    // Tool fields...
    ...getTrigger('{service}_event_a').subBlocks,
    ...getTrigger('{service}_event_b').subBlocks,
  ],
}
```

See `/add-trigger` skill for complete documentation.

## Step 6: Register Everything

### Tools Registry (`apps/sim/tools/registry.ts`)

```typescript
// Add import (alphabetically)
import {
  {service}Action1Tool,
  {service}Action2Tool,
} from '@/tools/{service}'

// Add to tools object (alphabetically)
export const tools: Record<string, ToolConfig> = {
  // ... existing tools ...
  {service}_action1: {service}Action1Tool,
  {service}_action2: {service}Action2Tool,
}
```

### Block Registry (`apps/sim/blocks/registry.ts`)

```typescript
// Add import (alphabetically)
import { {Service}Block } from '@/blocks/blocks/{service}'

// Add to registry (alphabetically)
export const registry: Record<string, BlockConfig> = {
  // ... existing blocks ...
  {service}: {Service}Block,
}
```

### Trigger Registry (`apps/sim/triggers/registry.ts`) - If triggers exist

```typescript
// Add import (alphabetically)
import {
  {service}EventATrigger,
  {service}EventBTrigger,
  {service}WebhookTrigger,
} from '@/triggers/{service}'

// Add to TRIGGER_REGISTRY (alphabetically)
export const TRIGGER_REGISTRY: TriggerRegistry = {
  // ... existing triggers ...
  {service}_event_a: {service}EventATrigger,
  {service}_event_b: {service}EventBTrigger,
  {service}_webhook: {service}WebhookTrigger,
}
```

## Step 7: Generate Docs

Run the documentation generator:
```bash
bun run scripts/generate-docs.ts
```

This creates `apps/docs/content/docs/en/tools/{service}.mdx`

## V2 Integration Pattern

If creating V2 versions (API-aligned outputs):

1. **V2 Tools** - Add `_v2` suffix, version `2.0.0`, flat outputs
2. **V2 Block** - Add `_v2` type, use `createVersionedToolSelector`
3. **V1 Block** - Add `(Legacy)` to name, set `hideFromToolbar: true`
4. **Registry** - Register both versions

```typescript
// In registry
{service}: {Service}Block,        // V1 (legacy, hidden)
{service}_v2: {Service}V2Block,   // V2 (visible)
```

## Complete Checklist

### Tools
- [ ] Created `tools/{service}/` directory
- [ ] Created `types.ts` with all interfaces
- [ ] Created tool file for each operation
- [ ] All params have correct visibility
- [ ] All nullable fields use `?? null`
- [ ] All optional outputs have `optional: true`
- [ ] Created `index.ts` barrel export
- [ ] Registered all tools in `tools/registry.ts`

### Block
- [ ] Created `blocks/blocks/{service}.ts`
- [ ] Defined operation dropdown with all operations
- [ ] Added credential field (oauth-input or short-input)
- [ ] Added conditional fields per operation
- [ ] Set up dependsOn for cascading selectors
- [ ] Configured tools.access with all tool IDs
- [ ] Configured tools.config.tool selector
- [ ] Defined outputs matching tool outputs
- [ ] Registered block in `blocks/registry.ts`
- [ ] If triggers: set `triggers.enabled` and `triggers.available`
- [ ] If triggers: spread trigger subBlocks with `getTrigger()`

### Icon
- [ ] Asked user to provide SVG
- [ ] Added icon to `components/icons.tsx`
- [ ] Icon spreads props correctly

### Triggers (if service supports webhooks)
- [ ] Created `triggers/{service}/` directory
- [ ] Created `utils.ts` with options, instructions, and extra fields helpers
- [ ] Primary trigger uses `includeDropdown: true`
- [ ] Secondary triggers do NOT have `includeDropdown`
- [ ] All triggers use `buildTriggerSubBlocks` helper
- [ ] Created `index.ts` barrel export
- [ ] Registered all triggers in `triggers/registry.ts`

### Docs
- [ ] Ran `bun run scripts/generate-docs.ts`
- [ ] Verified docs file created

## Example Command

When the user asks to add an integration:

```
User: Add a Stripe integration

You: I'll add the Stripe integration. Let me:

1. First, research the Stripe API using Context7
2. Create the tools for key operations (payments, subscriptions, etc.)
3. Create the block with operation dropdown
4. Register everything
5. Generate docs
6. Ask you for the Stripe icon SVG

[Proceed with implementation...]

[After completing steps 1-5...]

I've completed the Stripe integration. Before I can add the icon, please provide the SVG for Stripe.
You can usually find this in the service's brand/press kit page, or copy it from their website.

Paste the SVG code here and I'll convert it to a React component.
```

## File Handling

When your integration handles file uploads or downloads, follow these patterns to work with `UserFile` objects consistently.

### What is a UserFile?

A `UserFile` is the standard file representation in Sim:

```typescript
interface UserFile {
  id: string       // Unique identifier
  name: string     // Original filename
  url: string      // Presigned URL for download
  size: number     // File size in bytes
  type: string     // MIME type (e.g., 'application/pdf')
  base64?: string  // Optional base64 content (if small file)
  key?: string     // Internal storage key
  context?: object // Storage context metadata
}
```

### File Input Pattern (Uploads)

For tools that accept file uploads, **always route through an internal API endpoint** rather than calling external APIs directly. This ensures proper file content retrieval.

#### 1. Block SubBlocks for File Input

Use the basic/advanced mode pattern:

```typescript
// Basic mode: File upload UI
{
  id: 'uploadFile',
  title: 'File',
  type: 'file-upload',
  canonicalParamId: 'file',  // Maps to 'file' param
  placeholder: 'Upload file',
  mode: 'basic',
  multiple: false,
  required: true,
  condition: { field: 'operation', value: 'upload' },
},
// Advanced mode: Reference from previous block
{
  id: 'fileRef',
  title: 'File',
  type: 'short-input',
  canonicalParamId: 'file',  // Same canonical param
  placeholder: 'Reference file (e.g., {{file_block.output}})',
  mode: 'advanced',
  required: true,
  condition: { field: 'operation', value: 'upload' },
},
```

**Critical:** `canonicalParamId` must NOT match any subblock `id`.

#### 2. Normalize File Input in Block Config

In `tools.config.tool`, use `normalizeFileInput` to handle all input variants:

```typescript
import { normalizeFileInput } from '@/blocks/utils'

tools: {
  config: {
    tool: (params) => {
      // Normalize file from basic (uploadFile), advanced (fileRef), or legacy (fileContent)
      const normalizedFile = normalizeFileInput(
        params.uploadFile || params.fileRef || params.fileContent,
        { single: true }
      )
      if (normalizedFile) {
        params.file = normalizedFile
      }
      return `{service}_${params.operation}`
    },
  },
}
```

#### 3. Create Internal API Route

Create `apps/sim/app/api/tools/{service}/{action}/route.ts`:

```typescript
import { createLogger } from '@sim/logger'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { FileInputSchema, type RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'

const logger = createLogger('{Service}UploadAPI')

const RequestSchema = z.object({
  accessToken: z.string(),
  file: FileInputSchema.optional().nullable(),
  // Legacy field for backwards compatibility
  fileContent: z.string().optional().nullable(),
  // ... other params
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const data = RequestSchema.parse(body)

  let fileBuffer: Buffer
  let fileName: string

  // Prefer UserFile input, fall back to legacy base64
  if (data.file) {
    const userFiles = processFilesToUserFiles([data.file as RawFileInput], requestId, logger)
    if (userFiles.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid file' }, { status: 400 })
    }
    const userFile = userFiles[0]
    fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
    fileName = userFile.name
  } else if (data.fileContent) {
    // Legacy: base64 string (backwards compatibility)
    fileBuffer = Buffer.from(data.fileContent, 'base64')
    fileName = 'file'
  } else {
    return NextResponse.json({ success: false, error: 'File required' }, { status: 400 })
  }

  // Now call external API with fileBuffer
  const response = await fetch('https://api.{service}.com/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.accessToken}` },
    body: new Uint8Array(fileBuffer),  // Convert Buffer for fetch
  })

  // ... handle response
}
```

#### 4. Update Tool to Use Internal Route

```typescript
export const {service}UploadTool: ToolConfig<Params, Response> = {
  id: '{service}_upload',
  // ...
  params: {
    file: { type: 'file', required: false, visibility: 'user-or-llm' },
    fileContent: { type: 'string', required: false, visibility: 'hidden' }, // Legacy
  },
  request: {
    url: '/api/tools/{service}/upload',  // Internal route
    method: 'POST',
    body: (params) => ({
      accessToken: params.accessToken,
      file: params.file,
      fileContent: params.fileContent,
    }),
  },
}
```

### File Output Pattern (Downloads)

For tools that return files, use `FileToolProcessor` to store files and return `UserFile` objects.

#### In Tool transformResponse

```typescript
import { FileToolProcessor } from '@/executor/utils/file-tool-processor'

transformResponse: async (response, context) => {
  const data = await response.json()

  // Process file outputs to UserFile objects
  const fileProcessor = new FileToolProcessor(context)
  const file = await fileProcessor.processFileData({
    data: data.content,      // base64 or buffer
    mimeType: data.mimeType,
    filename: data.filename,
  })

  return {
    success: true,
    output: { file },
  }
}
```

#### In API Route (for complex file handling)

```typescript
// Return file data that FileToolProcessor can handle
return NextResponse.json({
  success: true,
  output: {
    file: {
      data: base64Content,
      mimeType: 'application/pdf',
      filename: 'document.pdf',
    },
  },
})
```

### Key Helpers Reference

| Helper | Location | Purpose |
|--------|----------|---------|
| `normalizeFileInput` | `@/blocks/utils` | Normalize file params in block config |
| `processFilesToUserFiles` | `@/lib/uploads/utils/file-utils` | Convert raw inputs to UserFile[] |
| `downloadFileFromStorage` | `@/lib/uploads/utils/file-utils.server` | Get file Buffer from UserFile |
| `FileToolProcessor` | `@/executor/utils/file-tool-processor` | Process tool output files |
| `isUserFile` | `@/lib/core/utils/user-file` | Type guard for UserFile objects |
| `FileInputSchema` | `@/lib/uploads/utils/file-schemas` | Zod schema for file validation |

### Common Gotchas

1. **OAuth serviceId must match** - The `serviceId` in oauth-input must match the OAuth provider configuration
2. **Tool IDs are snake_case** - `stripe_create_payment`, not `stripeCreatePayment`
3. **Block type is snake_case** - `type: 'stripe'`, not `type: 'Stripe'`
4. **Alphabetical ordering** - Keep imports and registry entries alphabetically sorted
5. **Required can be conditional** - Use `required: { field: 'op', value: 'create' }` instead of always true
6. **DependsOn clears options** - When a dependency changes, selector options are refetched
7. **Never pass Buffer directly to fetch** - Convert to `new Uint8Array(buffer)` for TypeScript compatibility
8. **Always handle legacy file params** - Keep hidden `fileContent` params for backwards compatibility
