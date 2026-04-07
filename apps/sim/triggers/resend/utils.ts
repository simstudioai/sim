import type { TriggerOutput } from '@/triggers/types'

/**
 * Maps Sim Resend trigger IDs to a single Resend webhook event type.
 * Kept in sync with subscription registration in `resend` webhook provider.
 */
export const RESEND_TRIGGER_TO_EVENT_TYPE: Record<string, string> = {
  resend_email_sent: 'email.sent',
  resend_email_delivered: 'email.delivered',
  resend_email_bounced: 'email.bounced',
  resend_email_complained: 'email.complained',
  resend_email_opened: 'email.opened',
  resend_email_clicked: 'email.clicked',
  resend_email_failed: 'email.failed',
}

/**
 * Event types registered for the catch-all `resend_webhook` trigger (API + matchEvent).
 */
export const RESEND_ALL_WEBHOOK_EVENT_TYPES: string[] = [
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.opened',
  'email.clicked',
  'email.failed',
  'email.received',
  'email.scheduled',
  'email.suppressed',
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'domain.created',
  'domain.updated',
  'domain.deleted',
]

/**
 * Shared trigger dropdown options for all Resend triggers
 */
export const resendTriggerOptions = [
  { label: 'Email Sent', id: 'resend_email_sent' },
  { label: 'Email Delivered', id: 'resend_email_delivered' },
  { label: 'Email Bounced', id: 'resend_email_bounced' },
  { label: 'Email Complained', id: 'resend_email_complained' },
  { label: 'Email Opened', id: 'resend_email_opened' },
  { label: 'Email Clicked', id: 'resend_email_clicked' },
  { label: 'Email Failed', id: 'resend_email_failed' },
  { label: 'Generic Webhook (All Events)', id: 'resend_webhook' },
]

/**
 * Generates setup instructions for Resend webhooks.
 * The webhook is automatically created in Resend when you save.
 */
export function resendSetupInstructions(eventType: string): string {
  const instructions = [
    'Enter your Resend API Key above.',
    'You can find your API key in Resend at <strong>Settings > API Keys</strong>. See the <a href="https://resend.com/docs/dashboard/api-keys/introduction" target="_blank" rel="noopener noreferrer">Resend API documentation</a> for details.',
    `Click <strong>"Save Configuration"</strong> to automatically create the webhook in Resend for <strong>${eventType}</strong> events.`,
    'The webhook will be automatically deleted when you remove this trigger.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Helper to build Resend-specific extra fields.
 * Includes API key (required).
 * Use with the generic buildTriggerSubBlocks from @/triggers.
 */
export function buildResendExtraFields(triggerId: string) {
  return [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as const,
      placeholder: 'Enter your Resend API key (re_...)',
      description: 'Required to create the webhook in Resend.',
      password: true,
      paramVisibility: 'user-only' as const,
      required: true,
      mode: 'trigger' as const,
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Common fields present in all Resend email webhook payloads
 * (see https://resend.com/docs/dashboard/webhooks/introduction — example `data` object).
 */
const commonEmailOutputs = {
  type: {
    type: 'string',
    description: 'Event type (e.g., email.sent, email.delivered)',
  },
  created_at: {
    type: 'string',
    description: 'Webhook event creation timestamp (ISO 8601), top-level `created_at`',
  },
  data_created_at: {
    type: 'string',
    description:
      'Email record timestamp from payload `data.created_at` (ISO 8601), when present — distinct from top-level `created_at`',
  },
  email_id: {
    type: 'string',
    description: 'Unique email identifier',
  },
  broadcast_id: {
    type: 'string',
    description: 'Broadcast ID associated with the email, when sent as part of a broadcast',
  },
  template_id: {
    type: 'string',
    description: 'Template ID used to send the email, when applicable',
  },
  tags: {
    type: 'json',
    description: 'Tag key/value metadata attached to the email (payload `data.tags`)',
  },
  from: {
    type: 'string',
    description: 'Sender email address',
  },
  subject: {
    type: 'string',
    description: 'Email subject line',
  },
} as const

/**
 * Recipient fields present in email webhook payloads
 */
const recipientOutputs = {
  to: {
    type: 'json',
    description: 'Array of recipient email addresses',
  },
} as const

const resendEventDataOutput: Record<string, TriggerOutput> = {
  data: {
    type: 'json',
    description:
      'Raw event `data` from Resend (shape varies by event type: email, contact, domain, etc.)',
  },
}

/**
 * Build outputs for email sent events
 */
export function buildEmailSentOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEmailOutputs,
    ...recipientOutputs,
    ...resendEventDataOutput,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for email delivered events
 */
export function buildEmailDeliveredOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEmailOutputs,
    ...recipientOutputs,
    ...resendEventDataOutput,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for email bounced events
 */
export function buildEmailBouncedOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEmailOutputs,
    ...recipientOutputs,
    ...resendEventDataOutput,
    bounceType: { type: 'string', description: 'Bounce type (e.g., Permanent)' },
    bounceSubType: { type: 'string', description: 'Bounce sub-type (e.g., Suppressed)' },
    bounceMessage: { type: 'string', description: 'Bounce error message' },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for email complained events
 */
export function buildEmailComplainedOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEmailOutputs,
    ...recipientOutputs,
    ...resendEventDataOutput,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for email opened events
 */
export function buildEmailOpenedOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEmailOutputs,
    ...recipientOutputs,
    ...resendEventDataOutput,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for email clicked events
 */
export function buildEmailClickedOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEmailOutputs,
    ...recipientOutputs,
    ...resendEventDataOutput,
    clickIpAddress: { type: 'string', description: 'IP address of the click' },
    clickLink: { type: 'string', description: 'URL that was clicked' },
    clickTimestamp: { type: 'string', description: 'Click timestamp (ISO 8601)' },
    clickUserAgent: { type: 'string', description: 'Browser user agent string' },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for email failed events
 */
export function buildEmailFailedOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEmailOutputs,
    ...recipientOutputs,
    ...resendEventDataOutput,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for generic webhook (all events).
 * Includes all possible fields across event types.
 */
export function buildResendOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEmailOutputs,
    ...recipientOutputs,
    ...resendEventDataOutput,
    bounceType: { type: 'string', description: 'Bounce type (e.g., Permanent)' },
    bounceSubType: { type: 'string', description: 'Bounce sub-type (e.g., Suppressed)' },
    bounceMessage: { type: 'string', description: 'Bounce error message' },
    clickIpAddress: { type: 'string', description: 'IP address of the click' },
    clickLink: { type: 'string', description: 'URL that was clicked' },
    clickTimestamp: { type: 'string', description: 'Click timestamp (ISO 8601)' },
    clickUserAgent: { type: 'string', description: 'Browser user agent string' },
  } as Record<string, TriggerOutput>
}
