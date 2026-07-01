import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Maps Sim Linq trigger IDs to a single Linq webhook event type.
 * Kept in sync with subscription registration in the `linq` webhook provider.
 */
export const LINQ_TRIGGER_TO_EVENT_TYPE: Record<string, string> = {
  linq_message_received: 'message.received',
  linq_message_delivered: 'message.delivered',
  linq_message_failed: 'message.failed',
  linq_message_read: 'message.read',
  linq_reaction_added: 'reaction.added',
}

/**
 * Every Linq webhook event type, registered for the catch-all `linq_webhook` trigger.
 * Mirrors the Linq OpenAPI `WebhookEventType` enum verbatim (all 27 values).
 */
export const LINQ_ALL_WEBHOOK_EVENT_TYPES: string[] = [
  'message.sent',
  'message.received',
  'message.read',
  'message.delivered',
  'message.failed',
  'message.edited',
  'reaction.added',
  'reaction.removed',
  'participant.added',
  'participant.removed',
  'chat.created',
  'chat.group_name_updated',
  'chat.group_icon_updated',
  'chat.group_name_update_failed',
  'chat.group_icon_update_failed',
  'chat.typing_indicator.started',
  'chat.typing_indicator.stopped',
  'phone_number.status_updated',
  'call.initiated',
  'call.ringing',
  'call.answered',
  'call.ended',
  'call.failed',
  'call.declined',
  'call.no_answer',
  'location.sharing.started',
  'location.sharing.stopped',
]

/** Shared trigger dropdown options for all Linq triggers. */
export const linqTriggerOptions = [
  { label: 'Message Received', id: 'linq_message_received' },
  { label: 'Message Delivered', id: 'linq_message_delivered' },
  { label: 'Message Failed', id: 'linq_message_failed' },
  { label: 'Message Read', id: 'linq_message_read' },
  { label: 'Reaction Added', id: 'linq_reaction_added' },
  { label: 'Webhook (All Events)', id: 'linq_webhook' },
]

/**
 * Generates setup instructions for Linq webhooks.
 * The subscription is created and deleted automatically via the Linq API.
 */
export function linqSetupInstructions(eventType: string): string {
  const instructions = [
    'Enter your Linq API Key above.',
    'You can find your API key in the <a href="https://docs.linqapp.com/" target="_blank" rel="noopener noreferrer">Linq partner dashboard</a>.',
    'Optionally restrict delivery to specific phone numbers (E.164, comma-separated). Leave empty to receive events from all numbers.',
    `Click <strong>"Save Configuration"</strong> to automatically create the webhook subscription in Linq for <strong>${eventType}</strong>.`,
    'The subscription is automatically deleted when you remove this trigger.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Builds Linq-specific extra fields for the trigger UI.
 * Includes the required API key and an optional phone-number filter.
 * Use with the generic `buildTriggerSubBlocks` from `@/triggers`.
 */
export function buildLinqExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'triggerApiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Linq API key',
      description: 'Required to create the webhook subscription in Linq.',
      password: true,
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'triggerPhoneNumbers',
      title: 'Phone Numbers (Optional)',
      type: 'short-input',
      placeholder: 'Leave empty for all numbers (e.g. +15551234567, +15557654321)',
      description: 'Comma-separated E.164 numbers to restrict which numbers deliver events.',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Outputs exposed by every Linq trigger.
 *
 * Only the delivery-envelope fields are documented in the Linq OpenAPI spec; the
 * per-event `data` shape is not enumerated, so it is surfaced as a JSON passthrough
 * rather than fabricating typed sub-fields.
 */
export function buildLinqOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: {
      type: 'string',
      description: 'Event type (e.g. message.received, message.delivered, reaction.added)',
    },
    eventId: {
      type: 'string',
      description: 'Unique event identifier used for deduplication',
    },
    createdAt: {
      type: 'string',
      description: 'ISO 8601 timestamp of when the event occurred',
    },
    webhookVersion: {
      type: 'string',
      description: 'Payload schema version of the delivered event',
    },
    data: {
      type: 'json',
      description:
        'Full event payload (shape varies by event type — message, reaction, chat, etc.)',
    },
  }
}
