/**
 * Extended Sim.ai Knowledge Base
 * Complete coverage: Triggers, Providers, Selectors, Files, Icons, Docs
 */

export const SIM_TRIGGERS_COMPLETE = `
# TRIGGERS - COMPLETE SPECIFICATION

## Types of Triggers

### 1. WEBHOOK TRIGGERS
- File: apps/sim/triggers/{service}/webhook.ts
- Primary trigger with includeDropdown: true
- Structure:
  {
    id: '{service}_webhook',
    name: 'Webhook',
    type: 'webhook',
    description: 'Receive {service} webhook events',
    outputs: { /* must match formatInput */ },
    includeDropdown: true,  // PRIMARY ONLY
    method: 'POST',
    path: '/webhook/{botId}/{workspaceId}',
  }

### 2. EVENT-SPECIFIC TRIGGERS
- File: apps/sim/triggers/{service}/{event}.ts
- Secondary triggers without includeDropdown
- Example: stripe/charge.completed.ts
- Structure:
  {
    id: 'stripe_charge_completed',
    name: 'Charge Completed',
    type: 'webhook',
    description: 'When charge is completed',
    outputs: {
      chargeId: { type: 'string', description: 'ID' },
      amount: { type: 'number', description: 'Amount' },
      currency: { type: 'string', description: 'Currency' }
    }
  }

### 3. POLLING TRIGGERS
- File: apps/sim/triggers/{service}/polling.ts
- When service has no webhooks
- Structure:
  {
    id: '{service}_polling',
    name: 'Poll for Changes',
    type: 'polling',
    description: 'Check for new items periodically',
    checkpointKey: 'lastTimestamp',  // for dedup
    interval: 60000,  // milliseconds
    outputs: { /* items list */ }
  }

## Provider Handlers

File: apps/sim/lib/webhooks/providers/{service}.ts

When trigger needs:
- HMAC/signature verification
- Custom token auth
- Event filtering
- Idempotency/dedup
- Custom input formatting
- Auto webhook subscription/deletion
- Challenge verification
- Custom success response

Provider handler exports:
```typescript
interface WebhookProvider {
  parseWebhook(request): Promise<WebhookPayload>;
  verifyAuth(request, secret): boolean;  // HMAC verification
  formatInput(payload): object;           // Transform to trigger outputs
  filterEvent(event): boolean;
  getEventId(payload): string;           // For idempotency
  createSubscription?(config): Promise<{ externalId }>;
  deleteSubscription?(externalId): Promise<void>;
  verifyChallenge?(request): boolean;
  customSuccessResponse?(): Response;
}
```

### HMAC Verification Example
\`\`\`typescript
import { createHmac } from 'crypto';

export function verifyStripeSig(body: string, sig: string, secret: string): boolean {
  const hash = createHmac('sha256', secret).update(body).digest('hex');
  return safeCompare(hash, sig);  // Use safeCompare from @sim/security
}
\`\`\`

### Auto Webhook Registration Example
\`\`\`typescript
export async function createSubscription(config: {
  externalId: string;
  webhookUrl: string;
}): Promise<{ externalId: string }> {
  const response = await fetch('https://api.stripe.com/v1/webhook_endpoints', {
    method: 'POST',
    headers: { Authorization: \`Bearer \${config.externalId}\` },
    body: new URLSearchParams({
      url: config.webhookUrl,
      'enabled_events[]': 'charge.completed',
      'enabled_events[]': 'charge.failed',
    })
  });
  const data = await response.json();
  return { externalId: data.id };
}
\`\`\`

## Trigger Outputs vs formatInput

CRITICAL RULE: Must match EXACTLY

\`\`\`typescript
// Define outputs
const outputs = {
  chargeId: { type: 'string' },
  amount: { type: 'number' },
  currency: { type: 'string' }
};

// formatInput MUST return exact keys
function formatInput(payload: any) {
  return {
    chargeId: payload.id,
    amount: payload.amount,
    currency: payload.currency
    // ✅ EXACTLY matches outputs keys
  };
}

// ❌ WRONG: Missing field
function formatInput_WRONG(payload: any) {
  return {
    chargeId: payload.id,
    amount: payload.amount
    // ❌ Missing 'currency'!
  };
}

// ❌ WRONG: Extra field
function formatInput_WRONG2(payload: any) {
  return {
    chargeId: payload.id,
    amount: payload.amount,
    currency: payload.currency,
    status: payload.status  // ❌ Not in outputs!
  };
}
\`\`\`

## Idempotency & Dedup

```typescript
// Use getEventId for dedup
export function getEventId(payload: any): string {
  return payload.id;  // Webhook service should include unique ID
}

// In provider handler:
const eventId = getEventId(payload);
const isDuplicate = await checkDedup(eventId);
if (isDuplicate) return 204;  // Skip duplicate
await recordDedup(eventId);
```

## Hard Rules for Triggers

❌ NEVER:
- Guess webhook payload structure if not documented
- Have formatInput keys ≠ outputs keys
- Render LLM fields for trigger-only params
- Implement trigger without verified payload schema

✅ ALWAYS:
- Verify webhook payload against docs
- Match formatInput keys to outputs exactly
- Implement HMAC if service signs webhooks
- Test with sample payloads
- Document event list
`;

export const SIM_SELECTORS_COMPLETE = `
# SELECTORS & DYNAMIC FIELDS - COMPLETE SPECIFICATION

## Dynamic Selector Pattern

When field values depend on another field:

\`\`\`typescript
{
  id: 'channel',
  type: 'channel-selector',
  title: 'Channel',
  mode: 'basic',
  canonicalParamId: 'channel',
  fetchOptions: async (params) => {
    // Fetch list from API
    const response = await fetch(
      \`https://api.service.com/channels?workspaceId=\${params.workspaceId}\`
    );
    const data = await response.json();
    return data.channels.map(ch => ({
      label: ch.name,
      value: ch.id
    }));
  }
}
\`\`\`

## dependsOn Pattern

Cascading selectors - child depends on parent value:

\`\`\`typescript
// Parent: workspace selector
{
  id: 'workspace',
  type: 'dropdown',
  title: 'Workspace',
  required: true
}

// Child: channels (only show if workspace selected)
{
  id: 'channel',
  type: 'channel-selector',
  title: 'Channel',
  dependsOn: 'workspace',  // ← Depends on parent
  fetchOptions: async (params) => {
    if (!params.workspace) return [];
    return fetchChannels(params.workspace);
  }
}
\`\`\`

## fetchOptionById Pattern

When you need individual option details:

\`\`\`typescript
{
  id: 'user',
  type: 'user-selector',
  fetchOptions: async (params) => {
    // List for dropdown
    const users = await fetchUsers();
    return users.map(u => ({ label: u.name, value: u.id }));
  },
  fetchOptionById: async (userId) => {
    // Get single user details
    const user = await fetchUser(userId);
    return { label: user.name, value: user.id, description: user.email };
  }
}
\`\`\`

## Selector Types

- channel-selector: Channels/groups/rooms
- user-selector: Users/members
- file-selector: Files in storage
- sheet-selector: Google Sheets
- folder-selector: Folders in cloud
- project-selector: Projects in CRM
- knowledge-selector: Knowledge bases
- workflow-selector: Other workflows
- document-selector: Documents
- variables-selector: Workflow variables
- mcp-selector: MCP servers/tools
- table-selector: Database tables

## Conditional Fields Pattern

Show/hide fields based on condition:

\`\`\`typescript
{
  id: 'apiKey',
  type: 'short-input',
  title: 'API Key',
  visibility: 'user-only',
  password: true,
  condition: (params) => params.authMode === 'api_key',
  // ↑ Only show if authMode is api_key
}

{
  id: 'oauthScopes',
  type: 'short-input',
  title: 'Required Scopes',
  condition: (params) => params.authMode === 'oauth',
  // ↑ Only show if authMode is oauth
}
\`\`\`

## reactiveCondition Pattern

For fields that react to credential type:

\`\`\`typescript
{
  id: 'workspace',
  type: 'dropdown',
  title: 'Workspace',
  reactiveCondition: (params) => {
    // If credential changed, re-fetch workspaces
    return params.credential?.id;
  },
  fetchOptions: async (params) => {
    if (!params.credential) return [];
    const workspaces = await fetchWorkspaces(params.credential.id);
    return workspaces;
  }
}
\`\`\`
`;

export const SIM_FILES_COMPLETE = `
# FILE HANDLING - COMPLETE SPECIFICATION

## File Upload Pattern

When service accepts file uploads:

### 1. Block Definition
\`\`\`typescript
// Basic: visual file selector
{
  id: 'file',
  type: 'file-upload',
  title: 'File',
  mode: 'basic',
  canonicalParamId: 'file',  // Links to canonical param
  required: true,
  visibility: 'user-or-llm'
}

// Advanced: manual file reference
{
  id: 'fileId',
  type: 'short-input',
  title: 'File ID (manual)',
  mode: 'advanced',
  canonicalParamId: 'file',  // SAME canonical ID
  description: 'Or enter file ID directly'
}
\`\`\`

### 2. Internal API Route
File: apps/sim/app/api/tools/{service}/{action}/route.ts

\`\`\`typescript
import { getUserFile } from '@/lib/files/get-user-file';
import { normalizeFileInput } from '@/lib/files/normalize-file-input';

export async function POST(request: Request) {
  const body = await request.json();

  // Normalize file input (handle both upload and reference)
  const file = await normalizeFileInput(body.file, body.fileId);

  // Get actual file content
  const buffer = await file.buffer();

  // Upload to external service
  const response = await fetch('https://api.service.com/upload', {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${body.apiKey}\`,
      'Content-Type': file.type
    },
    body: buffer
  });

  const result = await response.json();
  return Response.json({
    fileId: result.id,
    url: result.url,
    size: file.size
  });
}
\`\`\`

### 3. API Contract
File: apps/sim/lib/api/contracts/{service}-tools.ts

\`\`\`typescript
export const uploadFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/{service}/upload',
  body: z.object({
    file: z.object({
      id: z.string(),
      name: z.string(),
      size: z.number(),
      type: z.string()
    }).optional(),
    fileId: z.string().optional(),
    apiKey: z.string()
  }),
  response: {
    mode: 'json',
    schema: z.object({
      fileId: z.string(),
      url: z.string(),
      size: z.number()
    })
  }
});
\`\`\`

### 4. Tool Definition
\`\`\`typescript
{
  id: 'service_upload_file',
  params: {
    file: {
      type: 'file',
      required: true,
      visibility: 'user-or-llm'
    }
  },
  request: {
    url: () => '/api/tools/service/upload-file',  // ← Internal route!
    method: () => 'POST',
    body: (params) => ({
      file: params.file,
      apiKey: params.apiKey
    })
  },
  outputs: {
    fileId: { type: 'string' },
    url: { type: 'string' }
  }
}
\`\`\`

## File Download Pattern

When service returns files:

\`\`\`typescript
{
  id: 'service_export_file',
  outputs: {
    file: { type: 'file', description: 'Exported file' }
  },
  transformResponse: async (response, params) => {
    return {
      file: {
        id: generateId(),
        name: \`export_\${Date.now()}.csv\`,
        buffer: response.buffer,
        type: 'text/csv',
        size: response.buffer.length
      }
    };
  }
}
\`\`\`

## normalizeFileInput Helper

Handles both file upload and manual file reference:

\`\`\`typescript
export async function normalizeFileInput(
  uploadedFile?: UserFile,
  fileId?: string
): Promise<UserFile> {
  if (uploadedFile) {
    return uploadedFile;  // Use uploaded file
  }
  if (fileId) {
    return await getUserFile(fileId);  // Load by ID
  }
  throw new Error('Either file or fileId required');
}
\`\`\`

## FileToolProcessor

For downstream blocks to handle file outputs:

\`\`\`typescript
import { FileToolProcessor } from '@/lib/tools/file-processor';

const processor = new FileToolProcessor();
const fileOutput = processor.transform(toolResult, options);
// Converts file data to UserFile format
\`\`\`

## Rules for Files

❌ NEVER:
- Upload file directly from tool to external API
- Show file content in logs/outputs
- Forget to handle both upload and reference modes

✅ ALWAYS:
- Use internal API route for file handling
- Support both upload and file ID reference
- Use normalizeFileInput() for dual mode
- Set proper content-type headers
- Return file ID, not file content
`;

export const SIM_BLOCKMETA_COMPLETE = `
# BLOCKMETA - COMPLETE SPECIFICATION

## BlockMeta Structure

\`\`\`typescript
interface BlockMeta {
  tags: IntegrationTag[];           // Only existing enum values
  templates?: BlockTemplate[];      // 2-4 example workflows
  skills?: SuggestedSkill[];       // Suggested actions
  url?: string;                    // Docs link
}
\`\`\`

## Tags

Only use these enum values:
\`\`\`
AI, Analytics, Bot, Automation, Communication, CRM, Payment, E-commerce,
Data, Marketing, Observability, Productivity, Sales, Search, Security,
Support, Messaging, Calendar, Files, Docs, Email, Notification,
Webhook, API, Integration, Connector, Gateway, Database, Cache,
Queue, Stream, Monitor, Alert, Log, Trace, Metric, Analytics,
Billing, Subscription, Invoice, Contract, Form, Survey, Chat, Video,
Voice, Recording, Transcript, Translation, Detection, Recognition,
Analysis, Enrichment, Enrichment, Validation, Normalization, Deduplication,
Sync, Replication, Migration, Backup, Recovery, Disaster, Failover,
Proxy, Load, Balance, Rate, Limit, Throttle, Queue, Schedule, Trigger,
Event, Webhook, Hook, Callback, Subscription, Poll, Stream, Push, Pull
\`\`\`

## Templates

2-4 concrete use cases, not generic:

\`\`\`typescript
templates: [
  {
    name: 'Slack Alert on Failed Charge',
    category: 'Alert',
    prompt: 'Build a workflow that sends a Slack message when a Stripe charge fails'
  },
  {
    name: 'Create Invoice in Google Sheets',
    category: 'Data Sync',
    prompt: 'Create a workflow that generates a Stripe invoice and adds row to Google Sheets'
  },
  {
    name: 'Charge Card on Schedule',
    category: 'Automation',
    prompt: 'Build a workflow that charges a card at scheduled intervals'
  }
]
\`\`\`

Rules for templates:
- Prompt starts with "Build a workflow that..." or "Create a workflow that..."
- Concrete use case (not "Integration with Stripe" but "Slack alert on failed charge")
- Mention other integrations if used (alsoIntegrations field)
- 2-4 per integration (not 10+)
- Cover different dimensions (alerts, syncs, automations)

## Skills

Suggested actions when using this block:

\`\`\`typescript
skills: [
  {
    title: 'Charge Card',
    action: 'stripe_create_charge',
    description: 'Create a new charge on card'
  },
  {
    title: 'Get Invoice',
    action: 'stripe_retrieve_invoice',
    description: 'Fetch invoice details'
  },
  {
    title: 'List Customers',
    action: 'stripe_list_customers',
    description: 'Get all customers'
  }
]
\`\`\`

Rules for skills:
- kebab-case names (e.g., charge-card)
- One-line description
- Map to actual tool actions
- Show common operations
- 3-5 per integration
`;

export const SIM_ICONS_COMPLETE = `
# ICONS - COMPLETE SPECIFICATION

## Icon Component

File: apps/sim/components/icons.tsx

\`\`\`typescript
import React from 'react'

export function StripeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      {/* SVG path for Stripe logo */}
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
    </svg>
  )
}

// Usage in BlockConfig:
const StripeBlock: BlockConfig = {
  icon: StripeIcon,
  iconColor: '#635BFF',  // Brand color
  // ...
}
\`\`\`

Rules:
- SVG preferred (scalable)
- Preserve brand colors
- Usually 24x24 viewBox
- Include both icon function and color
- Add to icons.tsx (do NOT create separate file)

## Finding Icons

1. Official brand guidelines (e.g., stripe.com/brand)
2. If not available: use service initial (S for Stripe)
3. Or use generic API icon
`;

export const SIM_DOCS_COMPLETE = `
# DOCS GENERATION - COMPLETE SPECIFICATION

## Auto-Generated Docs

Command: \`bun run scripts/generate-docs.ts\`

Creates: apps/docs/content/docs/en/integrations/{service}.mdx

Structure:
- Title & description (from BlockConfig)
- Actions section (lists all tools)
  * One subsection per tool
  * Parameters documented
  * Example usage
- Triggers section (if webhooks)
  * Event types
  * Payload examples
  * Setup instructions
- Manual content block
  * Only place for manual edits
  * Rest is auto-generated

Cannot edit generated sections manually - only manually-marked blocks.

Rules:
- Run generation script after registration
- Verify docs created successfully
- Check Actions and Triggers sections
- Add manual content for unique setup instructions
`;

export const SIM_COMPLETE_CHECKLIST = \`
# COMPLETE 50+ ITEM VALIDATION CHECKLIST

## Source & API Documentation (8 items)
[ ] Official docs found
[ ] Official API reference found
[ ] Auth docs found
[ ] Webhook docs checked (if webhooks)
[ ] File upload/download docs checked (if files)
[ ] Rate limit docs found
[ ] Pagination docs found (if applicable)
[ ] Error/exception docs found

## Tools - Per Tool (50+ items total)
[ ] ID is {service}_{action} (snake_case)
[ ] name & description present
[ ] version: 1.0.0 (or 2.0.0 for V2)
[ ] All required params have required: true
[ ] All optional params have required: false
[ ] All params have correct visibility
  - API keys: user-only
  - OAuth tokens: hidden
  - Operation params: user-or-llm
  - Computed: llm-only (rare)
[ ] Request URL matches API docs
[ ] Request method correct (GET/POST/etc)
[ ] Request headers correct
[ ] Request body matches payload structure (if POST/PUT)
[ ] transformResponse only if schema verified
  - Nullable fields use ?? null
  - Optional arrays use ?? []
  - No guessed fields
[ ] outputs match documented response
[ ] No bare JSON (always typed if known)
[ ] No fields in outputs that aren't in API response
[ ] All optional output fields have optional: true
[ ] Registered in tools/registry.ts
[ ] Alphabetical order in registry

## Block - Single Item
[ ] type is kebab-case
[ ] name & description present
[ ] longDescription present
[ ] docsLink correct
[ ] category: 'tools'
[ ] integrationType is whitelisted enum
[ ] authMode correct
[ ] bgColor defined
[ ] icon imported
[ ] subBlocks cover all required params
[ ] Optional params in advanced mode
[ ] Operation dropdown present (if multiple tools)
[ ] canonicalParamId correct (if basic/advanced pair)
[ ] tools.access lists all tool IDs
[ ] tools.config.tool function selects correct tool
[ ] tools.config.params maps correctly
[ ] inputs schema matches tool inputs
[ ] outputs schema matches tool outputs
[ ] Registered in blocks/registry.ts
[ ] BlockMeta registered

## BlockMeta
[ ] tags: only whitelisted enum values
[ ] 2-4 templates (not 0, not 10+)
[ ] templates start with "Build a workflow that..."
[ ] skills: 3-5 items
[ ] skills link to actual tool IDs

## Auth (if OAuth)
[ ] Provider defined in lib/oauth/oauth.ts
[ ] Scopes centralized (not hardcoded)
[ ] Scopes added to SCOPE_DESCRIPTIONS
[ ] oauth-input subBlock in block
[ ] accessToken visibility: hidden in tools

## Auth (if ApiKey)
[ ] ApiKey field: user-only
[ ] ApiKey field: password: true
[ ] No ApiKey in outputs
[ ] No ApiKey in logs

## Triggers (if webhooks)
[ ] Webhook payload schema verified (NOT guessed)
[ ] Primary trigger: includeDropdown: true
[ ] Secondary triggers: no includeDropdown
[ ] outputs match formatInput keys EXACTLY
[ ] Provider handler created (if HMAC/complex)
[ ] HMAC verification if documented signature
[ ] Auto-registration if service supports
[ ] All triggers registered in trigger/registry.ts

## Files (if file operations)
[ ] file-upload basic subBlock
[ ] Advanced fallback with canonicalParamId
[ ] Internal API route created
[ ] API contract defined
[ ] normalizeFileInput used
[ ] FileToolProcessor for outputs
[ ] No direct external upload
[ ] UserFile handling correct

## Icons
[ ] Icon added to components/icons.tsx
[ ] Icon color matches brand

## Docs
[ ] Generated via bun run scripts/generate-docs.ts
[ ] Actions section created
[ ] Triggers section created (if webhooks)
[ ] Manual content block added (if needed)

## Registries
[ ] tools/registry.ts updated (alphabetical)
[ ] blocks/registry.ts updated (alphabetical)
[ ] triggers/registry.ts updated (if triggers)
[ ] integrations.json updated (if catalog)

## Final Validation
[ ] type-check passes
[ ] lint passes
[ ] Every output backed by API docs (not guessed)
[ ] No broken canonicalParamId links
[ ] No duplicated subBlock IDs
[ ] No unregistered tools/blocks/triggers
[ ] Coverage report generated
\`;
