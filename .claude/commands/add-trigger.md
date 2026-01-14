---
description: Create webhook triggers for a Sim integration using the generic trigger builder
argument-hint: <service-name>
---

# Add Trigger Skill

You are an expert at creating webhook triggers for Sim. You understand the trigger system, the generic `buildTriggerSubBlocks` helper, and how triggers connect to blocks.

## Your Task

When the user asks you to create triggers for a service:
1. Research what webhook events the service supports
2. Create the trigger files using the generic builder
3. Register triggers and connect them to the block

## Directory Structure

```
apps/sim/triggers/{service}/
├── index.ts              # Barrel exports
├── utils.ts              # Service-specific helpers (trigger options, setup instructions, extra fields)
├── {event_a}.ts          # Primary trigger (includes dropdown)
├── {event_b}.ts          # Secondary trigger (no dropdown)
├── {event_c}.ts          # Secondary trigger (no dropdown)
└── webhook.ts            # Generic webhook trigger (optional, for "all events")
```

## Step 1: Create utils.ts

This file contains service-specific helpers used by all triggers.

```typescript
import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Dropdown options for the trigger type selector.
 * These appear in the primary trigger's dropdown.
 */
export const {service}TriggerOptions = [
  { label: 'Event A', id: '{service}_event_a' },
  { label: 'Event B', id: '{service}_event_b' },
  { label: 'Event C', id: '{service}_event_c' },
  { label: 'Generic Webhook (All Events)', id: '{service}_webhook' },
]

/**
 * Generates HTML setup instructions for the trigger.
 * Displayed to users to help them configure webhooks in the external service.
 */
export function {service}SetupInstructions(eventType: string): string {
  const instructions = [
    'Copy the <strong>Webhook URL</strong> above',
    'Go to <strong>{Service} Settings > Webhooks</strong>',
    'Click <strong>Add Webhook</strong>',
    'Paste the webhook URL',
    `Select the <strong>${eventType}</strong> event type`,
    'Save the webhook configuration',
    'Click "Save" above to activate your trigger',
  ]

  return instructions
    .map((instruction, index) =>
      `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Service-specific extra fields to add to triggers.
 * These are inserted between webhookUrl and triggerSave.
 */
export function build{Service}ExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'projectId',
      title: 'Project ID (Optional)',
      type: 'short-input',
      placeholder: 'Leave empty for all projects',
      description: 'Optionally filter to a specific project',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Build outputs for this trigger type.
 * Outputs define what data is available to downstream blocks.
 */
export function build{Service}Outputs(): Record<string, TriggerOutput> {
  return {
    eventType: { type: 'string', description: 'The type of event that triggered this workflow' },
    resourceId: { type: 'string', description: 'ID of the affected resource' },
    timestamp: { type: 'string', description: 'When the event occurred (ISO 8601)' },
    // Nested outputs for complex data
    resource: {
      id: { type: 'string', description: 'Resource ID' },
      name: { type: 'string', description: 'Resource name' },
      status: { type: 'string', description: 'Current status' },
    },
    webhook: { type: 'json', description: 'Full webhook payload' },
  }
}
```

## Step 2: Create the Primary Trigger

The **primary trigger** is the first one listed. It MUST include `includeDropdown: true` so users can switch between trigger types.

```typescript
import { {Service}Icon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  build{Service}ExtraFields,
  build{Service}Outputs,
  {service}SetupInstructions,
  {service}TriggerOptions,
} from '@/triggers/{service}/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * {Service} Event A Trigger
 *
 * This is the PRIMARY trigger - it includes the dropdown for selecting trigger type.
 */
export const {service}EventATrigger: TriggerConfig = {
  id: '{service}_event_a',
  name: '{Service} Event A',
  provider: '{service}',
  description: 'Trigger workflow when Event A occurs',
  version: '1.0.0',
  icon: {Service}Icon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: '{service}_event_a',
    triggerOptions: {service}TriggerOptions,
    includeDropdown: true,  // PRIMARY TRIGGER - includes dropdown
    setupInstructions: {service}SetupInstructions('Event A'),
    extraFields: build{Service}ExtraFields('{service}_event_a'),
  }),

  outputs: build{Service}Outputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
```

## Step 3: Create Secondary Triggers

Secondary triggers do NOT include the dropdown (it's already in the primary trigger).

```typescript
import { {Service}Icon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  build{Service}ExtraFields,
  build{Service}Outputs,
  {service}SetupInstructions,
  {service}TriggerOptions,
} from '@/triggers/{service}/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * {Service} Event B Trigger
 */
export const {service}EventBTrigger: TriggerConfig = {
  id: '{service}_event_b',
  name: '{Service} Event B',
  provider: '{service}',
  description: 'Trigger workflow when Event B occurs',
  version: '1.0.0',
  icon: {Service}Icon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: '{service}_event_b',
    triggerOptions: {service}TriggerOptions,
    // NO includeDropdown - secondary trigger
    setupInstructions: {service}SetupInstructions('Event B'),
    extraFields: build{Service}ExtraFields('{service}_event_b'),
  }),

  outputs: build{Service}Outputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
```

## Step 4: Create index.ts Barrel Export

```typescript
export { {service}EventATrigger } from './event_a'
export { {service}EventBTrigger } from './event_b'
export { {service}EventCTrigger } from './event_c'
export { {service}WebhookTrigger } from './webhook'
```

## Step 5: Register Triggers

### Trigger Registry (`apps/sim/triggers/registry.ts`)

```typescript
// Add import
import {
  {service}EventATrigger,
  {service}EventBTrigger,
  {service}EventCTrigger,
  {service}WebhookTrigger,
} from '@/triggers/{service}'

// Add to TRIGGER_REGISTRY
export const TRIGGER_REGISTRY: TriggerRegistry = {
  // ... existing triggers ...
  {service}_event_a: {service}EventATrigger,
  {service}_event_b: {service}EventBTrigger,
  {service}_event_c: {service}EventCTrigger,
  {service}_webhook: {service}WebhookTrigger,
}
```

## Step 6: Connect Triggers to Block

In the block file (`apps/sim/blocks/blocks/{service}.ts`):

```typescript
import { {Service}Icon } from '@/components/icons'
import { getTrigger } from '@/triggers'
import type { BlockConfig } from '@/blocks/types'

export const {Service}Block: BlockConfig = {
  type: '{service}',
  name: '{Service}',
  // ... other config ...

  // Enable triggers and list available trigger IDs
  triggers: {
    enabled: true,
    available: [
      '{service}_event_a',
      '{service}_event_b',
      '{service}_event_c',
      '{service}_webhook',
    ],
  },

  subBlocks: [
    // Regular tool subBlocks first
    { id: 'operation', /* ... */ },
    { id: 'credential', /* ... */ },
    // ... other tool fields ...

    // Then spread ALL trigger subBlocks
    ...getTrigger('{service}_event_a').subBlocks,
    ...getTrigger('{service}_event_b').subBlocks,
    ...getTrigger('{service}_event_c').subBlocks,
    ...getTrigger('{service}_webhook').subBlocks,
  ],

  // ... tools config ...
}
```

## Automatic Webhook Registration (Preferred)

If the service's API supports programmatic webhook creation, implement automatic webhook registration instead of requiring users to manually configure webhooks. This provides a much better user experience.

### When to Use Automatic Registration

Check the service's API documentation for endpoints like:
- `POST /webhooks` or `POST /hooks` - Create webhook
- `DELETE /webhooks/{id}` - Delete webhook

Services that support this pattern include: Grain, Lemlist, Calendly, Airtable, Webflow, Typeform, etc.

### Implementation Steps

#### 1. Add API Key to Extra Fields

Update your `build{Service}ExtraFields` function to include an API key field:

```typescript
export function build{Service}ExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your {Service} API key',
      description: 'Required to create the webhook in {Service}.',
      password: true,
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    // Other optional fields (e.g., campaign filter, project filter)
    {
      id: 'projectId',
      title: 'Project ID (Optional)',
      type: 'short-input',
      placeholder: 'Leave empty for all projects',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}
```

#### 2. Update Setup Instructions for Automatic Creation

Change instructions to indicate automatic webhook creation:

```typescript
export function {service}SetupInstructions(eventType: string): string {
  const instructions = [
    'Enter your {Service} API Key above.',
    'You can find your API key in {Service} at <strong>Settings > API</strong>.',
    `Click <strong>"Save Configuration"</strong> to automatically create the webhook in {Service} for <strong>${eventType}</strong> events.`,
    'The webhook will be automatically deleted when you remove this trigger.',
  ]

  return instructions
    .map((instruction, index) =>
      `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}
```

#### 3. Add Webhook Creation to API Route

In `apps/sim/app/api/webhooks/route.ts`, add provider-specific logic after the database save:

```typescript
// --- {Service} specific logic ---
if (savedWebhook && provider === '{service}') {
  logger.info(`[${requestId}] {Service} provider detected. Creating webhook subscription.`)
  try {
    const result = await create{Service}WebhookSubscription(
      {
        id: savedWebhook.id,
        path: savedWebhook.path,
        providerConfig: savedWebhook.providerConfig,
      },
      requestId
    )

    if (result) {
      // Update the webhook record with the external webhook ID
      const updatedConfig = {
        ...(savedWebhook.providerConfig as Record<string, any>),
        externalId: result.id,
      }
      await db
        .update(webhook)
        .set({
          providerConfig: updatedConfig,
          updatedAt: new Date(),
        })
        .where(eq(webhook.id, savedWebhook.id))

      savedWebhook.providerConfig = updatedConfig
      logger.info(`[${requestId}] Successfully created {Service} webhook`, {
        externalHookId: result.id,
        webhookId: savedWebhook.id,
      })
    }
  } catch (err) {
    logger.error(
      `[${requestId}] Error creating {Service} webhook subscription, rolling back webhook`,
      err
    )
    await db.delete(webhook).where(eq(webhook.id, savedWebhook.id))
    return NextResponse.json(
      {
        error: 'Failed to create webhook in {Service}',
        details: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
// --- End {Service} specific logic ---
```

Then add the helper function at the end of the file:

```typescript
async function create{Service}WebhookSubscription(
  webhookData: any,
  requestId: string
): Promise<{ id: string } | undefined> {
  try {
    const { path, providerConfig } = webhookData
    const { apiKey, triggerId, projectId } = providerConfig || {}

    if (!apiKey) {
      throw new Error('{Service} API Key is required.')
    }

    // Map trigger IDs to service event types
    const eventTypeMap: Record<string, string | undefined> = {
      {service}_event_a: 'eventA',
      {service}_event_b: 'eventB',
      {service}_webhook: undefined, // Generic - no filter
    }

    const eventType = eventTypeMap[triggerId]
    const notificationUrl = `${getBaseUrl()}/api/webhooks/trigger/${path}`

    const requestBody: Record<string, any> = {
      url: notificationUrl,
    }

    if (eventType) {
      requestBody.eventType = eventType
    }

    if (projectId) {
      requestBody.projectId = projectId
    }

    const response = await fetch('https://api.{service}.com/webhooks', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    const responseBody = await response.json()

    if (!response.ok) {
      const errorMessage = responseBody.message || 'Unknown API error'
      let userFriendlyMessage = 'Failed to create webhook in {Service}'

      if (response.status === 401) {
        userFriendlyMessage = 'Invalid API Key. Please verify and try again.'
      } else if (errorMessage) {
        userFriendlyMessage = `{Service} error: ${errorMessage}`
      }

      throw new Error(userFriendlyMessage)
    }

    return { id: responseBody.id }
  } catch (error: any) {
    logger.error(`Exception during {Service} webhook creation`, { error: error.message })
    throw error
  }
}
```

#### 4. Add Webhook Deletion to Provider Subscriptions

In `apps/sim/lib/webhooks/provider-subscriptions.ts`:

1. Add a logger:
```typescript
const {service}Logger = createLogger('{Service}Webhook')
```

2. Add the delete function:
```typescript
export async function delete{Service}Webhook(webhook: any, requestId: string): Promise<void> {
  try {
    const config = getProviderConfig(webhook)
    const apiKey = config.apiKey as string | undefined
    const externalId = config.externalId as string | undefined

    if (!apiKey || !externalId) {
      {service}Logger.warn(`[${requestId}] Missing apiKey or externalId, skipping cleanup`)
      return
    }

    const response = await fetch(`https://api.{service}.com/webhooks/${externalId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })

    if (!response.ok && response.status !== 404) {
      {service}Logger.warn(`[${requestId}] Failed to delete webhook (non-fatal): ${response.status}`)
    } else {
      {service}Logger.info(`[${requestId}] Successfully deleted webhook ${externalId}`)
    }
  } catch (error) {
    {service}Logger.warn(`[${requestId}] Error deleting webhook (non-fatal)`, error)
  }
}
```

3. Add to `cleanupExternalWebhook`:
```typescript
export async function cleanupExternalWebhook(...): Promise<void> {
  // ... existing providers ...
  } else if (webhook.provider === '{service}') {
    await delete{Service}Webhook(webhook, requestId)
  }
}
```

### Key Points for Automatic Registration

- **API Key visibility**: Always use `password: true` for API key fields
- **Error handling**: Roll back the database webhook if external creation fails
- **External ID storage**: Save the external webhook ID in `providerConfig.externalId`
- **Graceful cleanup**: Don't fail webhook deletion if cleanup fails (use non-fatal logging)
- **User-friendly errors**: Map HTTP status codes to helpful error messages

## The buildTriggerSubBlocks Helper

This is the generic helper from `@/triggers` that creates consistent trigger subBlocks.

### Function Signature

```typescript
interface BuildTriggerSubBlocksOptions {
  triggerId: string                              // e.g., 'service_event_a'
  triggerOptions: Array<{ label: string; id: string }>  // Dropdown options
  includeDropdown?: boolean                      // true only for primary trigger
  setupInstructions: string                      // HTML instructions
  extraFields?: SubBlockConfig[]                 // Service-specific fields
  webhookPlaceholder?: string                    // Custom placeholder text
}

function buildTriggerSubBlocks(options: BuildTriggerSubBlocksOptions): SubBlockConfig[]
```

### What It Creates

The helper creates this structure:
1. **Dropdown** (only if `includeDropdown: true`) - Trigger type selector
2. **Webhook URL** - Read-only field with copy button
3. **Extra Fields** - Your service-specific fields (filters, options, etc.)
4. **Save Button** - Activates the trigger
5. **Instructions** - Setup guide for users

All fields automatically have:
- `mode: 'trigger'` - Only shown in trigger mode
- `condition: { field: 'selectedTriggerId', value: triggerId }` - Only shown when this trigger is selected

## Trigger Outputs & Webhook Input Formatting

### Important: Two Sources of Truth

There are two related but separate concerns:

1. **Trigger `outputs`** - Schema/contract defining what fields SHOULD be available. Used by UI for tag dropdown.
2. **`formatWebhookInput`** - Implementation that transforms raw webhook payload into actual data. Located in `apps/sim/lib/webhooks/utils.server.ts`.

**These MUST be aligned.** The fields returned by `formatWebhookInput` should match what's defined in trigger `outputs`. If they differ:
- Tag dropdown shows fields that don't exist (broken variable resolution)
- Or actual data has fields not shown in dropdown (users can't discover them)

### When to Add a formatWebhookInput Handler

- **Simple providers**: If the raw webhook payload structure already matches your outputs, you don't need a handler. The generic fallback returns `body` directly.
- **Complex providers**: If you need to transform, flatten, extract nested data, compute fields, or handle conditional logic, add a handler.

### Adding a Handler

In `apps/sim/lib/webhooks/utils.server.ts`, add a handler block:

```typescript
if (foundWebhook.provider === '{service}') {
  // Transform raw webhook body to match trigger outputs
  return {
    eventType: body.type,
    resourceId: body.data?.id || '',
    timestamp: body.created_at,
    resource: body.data,
  }
}
```

**Key rules:**
- Return fields that match your trigger `outputs` definition exactly
- No wrapper objects like `webhook: { data: ... }` or `{service}: { ... }`
- No duplication (don't spread body AND add individual fields)
- Use `null` for missing optional data, not empty objects with empty strings

### Verify Alignment

Run the alignment checker:
```bash
bunx scripts/check-trigger-alignment.ts {service}
```

## Trigger Outputs

Trigger outputs use the same schema as block outputs (NOT tool outputs).

**Supported:**
- `type` and `description` for simple fields
- Nested object structure for complex data

**NOT Supported:**
- `optional: true` (tool outputs only)
- `items` property (tool outputs only)

```typescript
export function buildOutputs(): Record<string, TriggerOutput> {
  return {
    // Simple fields
    eventType: { type: 'string', description: 'Event type' },
    timestamp: { type: 'string', description: 'When it occurred' },

    // Complex data - use type: 'json'
    payload: { type: 'json', description: 'Full event payload' },

    // Nested structure
    resource: {
      id: { type: 'string', description: 'Resource ID' },
      name: { type: 'string', description: 'Resource name' },
    },
  }
}
```

## Generic Webhook Trigger Pattern

For services with many event types, create a generic webhook that accepts all events:

```typescript
export const {service}WebhookTrigger: TriggerConfig = {
  id: '{service}_webhook',
  name: '{Service} Webhook (All Events)',
  // ...

  subBlocks: buildTriggerSubBlocks({
    triggerId: '{service}_webhook',
    triggerOptions: {service}TriggerOptions,
    setupInstructions: {service}SetupInstructions('All Events'),
    extraFields: [
      // Event type filter (optional)
      {
        id: 'eventTypes',
        title: 'Event Types',
        type: 'dropdown',
        multiSelect: true,
        options: [
          { label: 'Event A', id: 'event_a' },
          { label: 'Event B', id: 'event_b' },
        ],
        placeholder: 'Leave empty for all events',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: '{service}_webhook' },
      },
      // Plus any other service-specific fields
      ...build{Service}ExtraFields('{service}_webhook'),
    ],
  }),
}
```

## Checklist Before Finishing

### Utils
- [ ] Created `{service}TriggerOptions` array with all trigger IDs
- [ ] Created `{service}SetupInstructions` function with clear steps
- [ ] Created `build{Service}ExtraFields` for service-specific fields
- [ ] Created output builders for each trigger type

### Triggers
- [ ] Primary trigger has `includeDropdown: true`
- [ ] Secondary triggers do NOT have `includeDropdown`
- [ ] All triggers use `buildTriggerSubBlocks` helper
- [ ] All triggers have proper outputs defined
- [ ] Created `index.ts` barrel export

### Registration
- [ ] All triggers imported in `triggers/registry.ts`
- [ ] All triggers added to `TRIGGER_REGISTRY`
- [ ] Block has `triggers.enabled: true`
- [ ] Block has all trigger IDs in `triggers.available`
- [ ] Block spreads all trigger subBlocks: `...getTrigger('id').subBlocks`

### Automatic Webhook Registration (if supported)
- [ ] Added API key field to `build{Service}ExtraFields` with `password: true`
- [ ] Updated setup instructions for automatic webhook creation
- [ ] Added provider-specific logic to `apps/sim/app/api/webhooks/route.ts`
- [ ] Added `create{Service}WebhookSubscription` helper function
- [ ] Added `delete{Service}Webhook` function to `provider-subscriptions.ts`
- [ ] Added provider to `cleanupExternalWebhook` function

### Webhook Input Formatting
- [ ] Added handler in `apps/sim/lib/webhooks/utils.server.ts` (if custom formatting needed)
- [ ] Handler returns fields matching trigger `outputs` exactly
- [ ] Run `bunx scripts/check-trigger-alignment.ts {service}` to verify alignment

### Testing
- [ ] Run `bun run type-check` to verify no TypeScript errors
- [ ] Restart dev server to pick up new triggers
- [ ] Test trigger UI shows correctly in the block
- [ ] Test automatic webhook creation works (if applicable)
