---
description: Create webhook triggers for a Sim integration using the generic trigger builder
argument-hint: <service-name>
---

# Add Trigger

You are an expert at creating webhook triggers for Sim. You understand the trigger system, the generic `buildTriggerSubBlocks` helper, and how triggers connect to blocks.

## Your Task

1. Research what webhook events the service supports
2. Create the trigger files using the generic builder
3. Create a provider handler if custom auth, formatting, or subscriptions are needed
4. Register triggers and connect them to the block

## Directory Structure

```
apps/sim/triggers/{service}/
├── index.ts              # Barrel exports
├── utils.ts              # Service-specific helpers (options, instructions, extra fields, outputs)
├── {event_a}.ts          # Primary trigger (includes dropdown)
├── {event_b}.ts          # Secondary trigger (no dropdown)
└── webhook.ts            # Generic webhook trigger (optional, for "all events")

apps/sim/lib/webhooks/
├── provider-subscription-utils.ts  # Shared subscription helpers (getProviderConfig, getNotificationUrl)
├── providers/
│   ├── {service}.ts       # Provider handler (auth, formatInput, matchEvent, subscriptions)
│   ├── types.ts           # WebhookProviderHandler interface
│   ├── utils.ts           # Shared helpers (createHmacVerifier, verifyTokenAuth, skipByEventTypes)
│   └── registry.ts        # Handler map + default handler
```

## Step 1: Create `utils.ts`

This file contains all service-specific helpers used by triggers.

```typescript
import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

export const {service}TriggerOptions = [
  { label: 'Event A', id: '{service}_event_a' },
  { label: 'Event B', id: '{service}_event_b' },
]

export function {service}SetupInstructions(eventType: string): string {
  const instructions = [
    'Copy the <strong>Webhook URL</strong> above',
    'Go to <strong>{Service} Settings > Webhooks</strong>',
    `Select the <strong>${eventType}</strong> event type`,
    'Paste the webhook URL and save',
    'Click "Save" above to activate your trigger',
  ]
  return instructions
    .map((instruction, index) =>
      `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

export function build{Service}ExtraFields(triggerId: string): SubBlockConfig[] {
  return [
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

export function build{Service}Outputs(): Record<string, TriggerOutput> {
  return {
    eventType: { type: 'string', description: 'The type of event' },
    resourceId: { type: 'string', description: 'ID of the affected resource' },
    resource: {
      id: { type: 'string', description: 'Resource ID' },
      name: { type: 'string', description: 'Resource name' },
    },
  }
}
```

## Step 2: Create Trigger Files

**Primary trigger** — MUST include `includeDropdown: true`:

```typescript
import { {Service}Icon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import { build{Service}ExtraFields, build{Service}Outputs, {service}SetupInstructions, {service}TriggerOptions } from '@/triggers/{service}/utils'
import type { TriggerConfig } from '@/triggers/types'

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
    includeDropdown: true,
    setupInstructions: {service}SetupInstructions('Event A'),
    extraFields: build{Service}ExtraFields('{service}_event_a'),
  }),
  outputs: build{Service}Outputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
```

**Secondary triggers** — NO `includeDropdown` (it's already in the primary):

```typescript
export const {service}EventBTrigger: TriggerConfig = {
  // Same as above but: id: '{service}_event_b', no includeDropdown
}
```

## Step 3: Register and Wire

### `apps/sim/triggers/{service}/index.ts`

```typescript
export { {service}EventATrigger } from './event_a'
export { {service}EventBTrigger } from './event_b'
```

### `apps/sim/triggers/registry.ts`

```typescript
import { {service}EventATrigger, {service}EventBTrigger } from '@/triggers/{service}'

export const TRIGGER_REGISTRY: TriggerRegistry = {
  // ... existing ...
  {service}_event_a: {service}EventATrigger,
  {service}_event_b: {service}EventBTrigger,
}
```

### Block file (`apps/sim/blocks/blocks/{service}.ts`)

```typescript
import { getTrigger } from '@/triggers'

export const {Service}Block: BlockConfig = {
  // ...
  triggers: {
    enabled: true,
    available: ['{service}_event_a', '{service}_event_b'],
  },
  subBlocks: [
    // Regular tool subBlocks first...
    ...getTrigger('{service}_event_a').subBlocks,
    ...getTrigger('{service}_event_b').subBlocks,
  ],
}
```

## Provider Handler

All provider-specific webhook logic lives in a single handler file: `apps/sim/lib/webhooks/providers/{service}.ts`.

### When to Create a Handler

| Behavior | Method | Examples |
|---|---|---|
| HMAC signature auth | `verifyAuth` via `createHmacVerifier` | Ashby, Jira, Linear, Typeform |
| Custom token auth | `verifyAuth` via `verifyTokenAuth` | Generic, Google Forms |
| Event filtering | `matchEvent` | GitHub, Jira, Attio, HubSpot |
| Idempotency dedup | `extractIdempotencyId` | Slack, Stripe, Linear, Jira |
| Custom input formatting | `formatInput` | Slack, Teams, Attio, Ashby |
| Auto webhook creation | `createSubscription` | Ashby, Grain, Calendly, Airtable |
| Auto webhook deletion | `deleteSubscription` | Ashby, Grain, Calendly, Airtable |
| Challenge/verification | `handleChallenge` | Slack, WhatsApp, Teams |
| Custom success response | `formatSuccessResponse` | Slack, Twilio Voice, Teams |

If none apply, you don't need a handler. The default handler provides bearer token auth.

### Example Handler

```typescript
import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@/lib/core/security/encryption'
import type { EventMatchContext, FormatInputContext, FormatInputResult, WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:{Service}')

function validate{Service}Signature(secret: string, signature: string, body: string): boolean {
  if (!secret || !signature || !body) return false
  const computed = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  return safeCompare(computed, signature)
}

export const {service}Handler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-{Service}-Signature',
    validateFn: validate{Service}Signature,
    providerLabel: '{Service}',
  }),

  async matchEvent({ body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (triggerId && triggerId !== '{service}_webhook') {
      const { is{Service}EventMatch } = await import('@/triggers/{service}/utils')
      if (!is{Service}EventMatch(triggerId, body as Record<string, unknown>)) return false
    }
    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    return {
      input: {
        eventType: b.type,
        resourceId: (b.data as Record<string, unknown>)?.id || '',
        resource: b.data,
      },
    }
  },

  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    return obj.id && obj.type ? `${obj.type}:${obj.id}` : null
  },
}
```

### Register the Handler

In `apps/sim/lib/webhooks/providers/registry.ts`:

```typescript
import { {service}Handler } from '@/lib/webhooks/providers/{service}'

const PROVIDER_HANDLERS: Record<string, WebhookProviderHandler> = {
  // ... existing (alphabetical) ...
  {service}: {service}Handler,
}
```

## Output Alignment (Critical)

There are two sources of truth that **MUST be aligned**:

1. **Trigger `outputs`** — schema defining what fields SHOULD be available (UI tag dropdown)
2. **`formatInput` on the handler** — implementation that transforms raw payload into actual data

If they differ: the tag dropdown shows fields that don't exist, or actual data has fields users can't discover.

**Rules for `formatInput`:**
- Return `{ input: { ... } }` where inner keys match trigger `outputs` exactly
- Return `{ input: ..., skip: { message: '...' } }` to skip execution
- No wrapper objects or duplication
- Use `null` for missing optional data

## Automatic Webhook Registration

If the service API supports programmatic webhook creation, implement `createSubscription` and `deleteSubscription` on the handler. The orchestration layer calls these automatically — **no code touches `route.ts`, `provider-subscriptions.ts`, or `deploy.ts`**.

```typescript
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type { DeleteSubscriptionContext, SubscriptionContext, SubscriptionResult } from '@/lib/webhooks/providers/types'

export const {service}Handler: WebhookProviderHandler = {
  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(ctx.webhook)
    const apiKey = config.apiKey as string
    if (!apiKey) throw new Error('{Service} API Key is required.')

    const res = await fetch('https://api.{service}.com/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: getNotificationUrl(ctx.webhook) }),
    })

    if (!res.ok) throw new Error(`{Service} error: ${res.status}`)
    const { id } = (await res.json()) as { id: string }
    return { providerConfigUpdates: { externalId: id } }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    const config = getProviderConfig(ctx.webhook)
    const { apiKey, externalId } = config as { apiKey?: string; externalId?: string }
    if (!apiKey || !externalId) return
    await fetch(`https://api.{service}.com/webhooks/${externalId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => {})
  },
}
```

**Key points:**
- Throw from `createSubscription` — orchestration rolls back the DB webhook
- Never throw from `deleteSubscription` — log non-fatally
- Return `{ providerConfigUpdates: { externalId } }` — orchestration merges into `providerConfig`
- Add `apiKey` field to `build{Service}ExtraFields` with `password: true`

## Trigger Outputs Schema

Trigger outputs use the same schema as block outputs (NOT tool outputs).

**Supported:** `type` + `description` for leaf fields, nested objects for complex data.
**NOT supported:** `optional: true`, `items` (those are tool-output-only features).

```typescript
export function buildOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: { type: 'string', description: 'Event type' },
    timestamp: { type: 'string', description: 'When it occurred' },
    payload: { type: 'json', description: 'Full event payload' },
    resource: {
      id: { type: 'string', description: 'Resource ID' },
      name: { type: 'string', description: 'Resource name' },
    },
  }
}
```

## Checklist

### Trigger Definition
- [ ] Created `utils.ts` with options, instructions, extra fields, and output builders
- [ ] Primary trigger has `includeDropdown: true`; secondary triggers do NOT
- [ ] All triggers use `buildTriggerSubBlocks` helper
- [ ] Created `index.ts` barrel export

### Registration
- [ ] All triggers in `triggers/registry.ts` → `TRIGGER_REGISTRY`
- [ ] Block has `triggers.enabled: true` and lists all trigger IDs in `triggers.available`
- [ ] Block spreads all trigger subBlocks: `...getTrigger('id').subBlocks`

### Provider Handler (if needed)
- [ ] Handler file at `apps/sim/lib/webhooks/providers/{service}.ts`
- [ ] Registered in `providers/registry.ts` (alphabetical)
- [ ] Signature validator is a private function inside the handler file
- [ ] `formatInput` output keys match trigger `outputs` exactly
- [ ] Event matching uses dynamic `await import()` for trigger utils

### Auto Registration (if supported)
- [ ] `createSubscription` and `deleteSubscription` on the handler
- [ ] NO changes to `route.ts`, `provider-subscriptions.ts`, or `deploy.ts`
- [ ] API key field uses `password: true`

### Testing
- [ ] `bun run type-check` passes
- [ ] Manually verify `formatInput` output keys match trigger `outputs` keys
- [ ] Trigger UI shows correctly in the block
