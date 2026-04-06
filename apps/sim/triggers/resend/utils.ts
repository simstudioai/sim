import type { TriggerOutput } from '@/triggers/types'

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
 */
const commonEmailOutputs = {
  type: {
    type: 'string',
    description: 'Event type (e.g., email.sent, email.delivered)',
  },
  created_at: {
    type: 'string',
    description: 'Event creation timestamp (ISO 8601)',
  },
  email_id: {
    type: 'string',
    description: 'Unique email identifier',
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

/**
 * Build outputs for email sent events
 */
export function buildEmailSentOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEmailOutputs,
    ...recipientOutputs,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for email delivered events
 */
export function buildEmailDeliveredOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEmailOutputs,
    ...recipientOutputs,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for email bounced events
 */
export function buildEmailBouncedOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEmailOutputs,
    ...recipientOutputs,
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
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for email opened events
 */
export function buildEmailOpenedOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEmailOutputs,
    ...recipientOutputs,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for email clicked events
 */
export function buildEmailClickedOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEmailOutputs,
    ...recipientOutputs,
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
    bounceType: { type: 'string', description: 'Bounce type (e.g., Permanent)' },
    bounceSubType: { type: 'string', description: 'Bounce sub-type (e.g., Suppressed)' },
    bounceMessage: { type: 'string', description: 'Bounce error message' },
    clickIpAddress: { type: 'string', description: 'IP address of the click' },
    clickLink: { type: 'string', description: 'URL that was clicked' },
    clickTimestamp: { type: 'string', description: 'Click timestamp (ISO 8601)' },
    clickUserAgent: { type: 'string', description: 'Browser user agent string' },
  } as Record<string, TriggerOutput>
}
