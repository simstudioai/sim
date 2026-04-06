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

All subscription lifecycle logic lives on the provider handler — **no code touches `route.ts` or `provider-subscriptions.ts`**.

### When to Use Automatic Registration

Check the service's API documentation for endpoints like:
- `POST /webhooks` or `POST /hooks` - Create webhook
- `DELETE /webhooks/{id}` - Delete webhook

Services that support this pattern include: Grain, Lemlist, Calendly, Airtable, Webflow, Typeform, Ashby, Attio, etc.

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

#### 3. Add `createSubscription` and `deleteSubscription` to the Provider Handler

In `apps/sim/lib/webhooks/providers/{service}.ts`, add both lifecycle methods to your handler. The orchestration layer (`provider-subscriptions.ts`, `deploy.ts`, `route.ts`) calls these automatically — you never touch those files.

```typescript
import { createLogger } from '@sim/logger'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/providers/subscription-utils'
import type {
  DeleteSubscriptionContext,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:{Service}')

export const {service}Handler: WebhookProviderHandler = {
  // ... other methods (verifyAuth, formatInput, etc.) ...

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    try {
      const providerConfig = getProviderConfig(ctx.webhook)
      const apiKey = providerConfig.apiKey as string | undefined
      const triggerId = providerConfig.triggerId as string | undefined

      if (!apiKey) {
        throw new Error('{Service} API Key is required.')
      }

      // Map trigger IDs to service event types
      const eventTypeMap: Record<string, string | undefined> = {
        {service}_event_a: 'eventA',
        {service}_event_b: 'eventB',
        {service}_webhook: undefined, // Generic - no filter
      }

      const eventType = eventTypeMap[triggerId ?? '']
      const notificationUrl = getNotificationUrl(ctx.webhook)

      const requestBody: Record<string, unknown> = {
        url: notificationUrl,
      }
      if (eventType) {
        requestBody.eventType = eventType
      }

      const response = await fetch('https://api.{service}.com/webhooks', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const responseBody = (await response.json()) as Record<string, unknown>

      if (!response.ok) {
        const errorMessage = (responseBody.message as string) || 'Unknown API error'
        let userFriendlyMessage = 'Failed to create webhook in {Service}'
        if (response.status === 401) {
          userFriendlyMessage = 'Invalid API Key. Please verify and try again.'
        } else if (errorMessage) {
          userFriendlyMessage = `{Service} error: ${errorMessage}`
        }
        throw new Error(userFriendlyMessage)
      }

      const externalId = responseBody.id as string | undefined
      if (!externalId) {
        throw new Error('{Service} webhook created but no ID was returned.')
      }

      logger.info(`[${ctx.requestId}] Created {Service} webhook ${externalId}`)
      return { providerConfigUpdates: { externalId } }
    } catch (error: unknown) {
      const err = error as Error
      logger.error(`[${ctx.requestId}] {Service} webhook creation failed`, {
        message: err.message,
      })
      throw error
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(ctx.webhook)
      const apiKey = config.apiKey as string | undefined
      const externalId = config.externalId as string | undefined

      if (!apiKey || !externalId) {
        logger.warn(`[${ctx.requestId}] Missing apiKey or externalId, skipping cleanup`)
        return
      }

      const response = await fetch(`https://api.{service}.com/webhooks/${externalId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
      })

      if (!response.ok && response.status !== 404) {
        logger.warn(
          `[${ctx.requestId}] Failed to delete {Service} webhook (non-fatal): ${response.status}`
        )
      } else {
        logger.info(`[${ctx.requestId}] Successfully deleted {Service} webhook ${externalId}`)
      }
    } catch (error) {
      logger.warn(`[${ctx.requestId}] Error deleting {Service} webhook (non-fatal)`, error)
    }
  },
}
```

#### How It Works

The orchestration layer handles everything automatically:

1. **Creation**: `provider-subscriptions.ts` → `createExternalWebhookSubscription()` calls `handler.createSubscription()` → merges `providerConfigUpdates` into the saved webhook record.
2. **Deletion**: `provider-subscriptions.ts` → `cleanupExternalWebhook()` calls `handler.deleteSubscription()` → errors are caught and logged non-fatally.
3. **Polling config**: `deploy.ts` → `configurePollingIfNeeded()` calls `handler.configurePolling()` for credential-based providers (Gmail, Outlook, RSS, IMAP).

You do NOT need to modify any orchestration files. Just implement the methods on your handler.

#### Shared Utilities for Subscriptions

Import from `@/lib/webhooks/providers/subscription-utils`:

- `getProviderConfig(webhook)` — safely extract `providerConfig` as `Record<string, unknown>`
- `getNotificationUrl(webhook)` — build the full callback URL: `{baseUrl}/api/webhooks/trigger/{path}`
- `getCredentialOwner(credentialId, requestId)` — resolve OAuth credential to `{ userId, accountId }` (for OAuth-based providers like Airtable, Attio)

### Key Points for Automatic Registration

- **API Key visibility**: Always use `password: true` for API key fields
- **Error handling**: Throw from `createSubscription` — the orchestration layer catches it, rolls back the DB webhook, and returns a 500
- **External ID storage**: Return `{ providerConfigUpdates: { externalId } }` — the orchestration layer merges it into `providerConfig`
- **Graceful cleanup**: In `deleteSubscription`, catch errors and log non-fatally (never throw)
- **User-friendly errors**: Map HTTP status codes to helpful error messages in `createSubscription`

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

## Webhook Provider Handler (Optional)

If the service requires **custom webhook auth** (HMAC signatures, token validation), **event matching** (filtering by trigger type), **idempotency dedup**, **custom input formatting**, or **subscription lifecycle** — all of this lives in a single provider handler file.

### Directory

```
apps/sim/lib/webhooks/providers/
├── types.ts              # WebhookProviderHandler interface (16 optional methods)
├── utils.ts              # Shared helpers (createHmacVerifier, verifyTokenAuth, skipByEventTypes)
├── subscription-utils.ts # Shared subscription helpers (getProviderConfig, getNotificationUrl, getCredentialOwner)
├── registry.ts           # Handler map + default handler
├── index.ts              # Barrel export
└── {service}.ts          # Your provider handler (ALL provider-specific logic here)
```

### When to Create a Handler

| Behavior | Method to implement | Example providers |
|---|---|---|
| HMAC signature auth | `verifyAuth` via `createHmacVerifier` | Ashby, Jira, Linear, Typeform |
| Custom token auth | `verifyAuth` via `verifyTokenAuth` | Generic, Google Forms |
| Event type filtering | `matchEvent` | GitHub, Jira, Confluence, Attio, HubSpot |
| Event skip by type list | `shouldSkipEvent` via `skipByEventTypes` | Stripe, Grain |
| Idempotency dedup | `extractIdempotencyId` | Slack, Stripe, Linear, Jira |
| Custom success response | `formatSuccessResponse` | Slack, Twilio Voice, Microsoft Teams |
| Custom error format | `formatErrorResponse` | Microsoft Teams |
| Custom input formatting | `formatInput` | Slack, Teams, Attio, Ashby, Gmail, Outlook |
| Auto webhook creation | `createSubscription` | Ashby, Grain, Calendly, Airtable, Typeform |
| Auto webhook deletion | `deleteSubscription` | Ashby, Grain, Calendly, Airtable, Typeform |
| Polling setup | `configurePolling` | Gmail, Outlook, RSS, IMAP |
| Challenge/verification | `handleChallenge` | Slack, WhatsApp, Microsoft Teams |

If none of these apply, you do NOT need a handler file. The default handler provides bearer token auth for providers that set `providerConfig.token`.

### Simple Example: HMAC Auth Only

Signature validators are defined as private functions **inside the handler file** (not in a shared utils file):

```typescript
import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:{Service}')

function validate{Service}Signature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) return false
    if (!signature.startsWith('sha256=')) return false
    const provided = signature.substring(7)
    const computed = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    return safeCompare(computed, provided)
  } catch (error) {
    logger.error('Error validating {Service} signature:', error)
    return false
  }
}

export const {service}Handler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-{Service}-Signature',
    validateFn: validate{Service}Signature,
    providerLabel: '{Service}',
  }),
}
```

### Example: Auth + Event Matching + Idempotency

```typescript
import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
import type { EventMatchContext, WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:{Service}')

function validate{Service}Signature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) return false
    const computed = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    return safeCompare(computed, signature)
  } catch (error) {
    logger.error('Error validating {Service} signature:', error)
    return false
  }
}

export const {service}Handler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-{Service}-Signature',
    validateFn: validate{Service}Signature,
    providerLabel: '{Service}',
  }),

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>

    if (triggerId && triggerId !== '{service}_webhook') {
      const { is{Service}EventMatch } = await import('@/triggers/{service}/utils')
      if (!is{Service}EventMatch(triggerId, obj)) {
        logger.debug(
          `[${requestId}] {Service} event mismatch for trigger ${triggerId}. Skipping.`,
          { webhookId: webhook.id, workflowId: workflow.id, triggerId }
        )
        return false
      }
    }

    return true
  },

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    if (obj.id && obj.type) {
      return `${obj.type}:${obj.id}`
    }
    return null
  },
}
```

### Registering the Handler

In `apps/sim/lib/webhooks/providers/registry.ts`:

```typescript
import { {service}Handler } from '@/lib/webhooks/providers/{service}'

const PROVIDER_HANDLERS: Record<string, WebhookProviderHandler> = {
  // ... existing providers (alphabetical) ...
  {service}: {service}Handler,
}
```

## Trigger Outputs & Webhook Input Formatting

### Important: Two Sources of Truth

There are two related but separate concerns:

1. **Trigger `outputs`** - Schema/contract defining what fields SHOULD be available. Used by UI for tag dropdown.
2. **`formatInput` on the handler** - Implementation that transforms raw webhook payload into actual data. Defined in `apps/sim/lib/webhooks/providers/{service}.ts`.

**These MUST be aligned.** The fields returned by `formatInput` should match what's defined in trigger `outputs`. If they differ:
- Tag dropdown shows fields that don't exist (broken variable resolution)
- Or actual data has fields not shown in dropdown (users can't discover them)

### When to Add `formatInput`

- **Simple providers**: If the raw webhook payload structure already matches your outputs, you don't need it. The fallback passes through the raw body directly.
- **Complex providers**: If you need to transform, flatten, extract nested data, compute fields, or handle conditional logic, add `formatInput` to your handler.

### Adding `formatInput` to Your Handler

In `apps/sim/lib/webhooks/providers/{service}.ts`:

```typescript
import type {
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

export const {service}Handler: WebhookProviderHandler = {
  // ... other methods ...

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    return {
      input: {
        eventType: b.type,
        resourceId: (b.data as Record<string, unknown>)?.id || '',
        timestamp: b.created_at,
        resource: b.data,
      },
    }
  },
}
```

**Key rules:**
- Return `{ input: { ... } }` where the inner object matches your trigger `outputs` definition exactly
- Return `{ input: ..., skip: { message: '...' } }` to skip execution for this event
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

### Webhook Provider Handler (`providers/{service}.ts`)
- [ ] Created handler file in `apps/sim/lib/webhooks/providers/{service}.ts`
- [ ] Registered handler in `apps/sim/lib/webhooks/providers/registry.ts` (alphabetical)
- [ ] Signature validator defined as private function inside handler file (not in a shared file)
- [ ] Used `createHmacVerifier` from `providers/utils` for HMAC-based auth
- [ ] Used `verifyTokenAuth` from `providers/utils` for token-based auth
- [ ] Event matching uses dynamic `await import()` for trigger utils
- [ ] Added `formatInput` if webhook payload needs transformation (returns `{ input: ... }`)

### Automatic Webhook Registration (if supported)
- [ ] Added API key field to `build{Service}ExtraFields` with `password: true`
- [ ] Updated setup instructions for automatic webhook creation
- [ ] Added `createSubscription` method to handler (uses `getNotificationUrl`, `getProviderConfig` from `subscription-utils`)
- [ ] Added `deleteSubscription` method to handler (catches errors, logs non-fatally)
- [ ] NO changes needed to `route.ts`, `provider-subscriptions.ts`, or `deploy.ts`

### Testing
- [ ] Run `bun run type-check` to verify no TypeScript errors
- [ ] Run `bunx scripts/check-trigger-alignment.ts {service}` to verify output alignment
- [ ] Restart dev server to pick up new triggers
- [ ] Test trigger UI shows correctly in the block
- [ ] Test automatic webhook creation works (if applicable)
