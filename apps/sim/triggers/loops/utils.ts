import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Maps Sim Loops trigger IDs to the Loops webhook `eventName` value.
 * Kept in sync with `matchEvent` in the Loops webhook provider handler.
 * @see https://loops.so/docs/webhooks
 */
export const LOOPS_TRIGGER_TO_EVENT_TYPE: Record<string, string> = {
  loops_email_delivered: 'email.delivered',
  loops_email_opened: 'email.opened',
  loops_email_clicked: 'email.clicked',
  loops_email_hard_bounced: 'email.hardBounced',
  loops_email_soft_bounced: 'email.softBounced',
  loops_campaign_email_sent: 'campaign.email.sent',
  loops_loop_email_sent: 'loop.email.sent',
  loops_transactional_email_sent: 'transactional.email.sent',
}

/**
 * Shared trigger dropdown options for all Loops triggers.
 */
export const loopsTriggerOptions = [
  { label: 'Email Delivered', id: 'loops_email_delivered' },
  { label: 'Email Opened', id: 'loops_email_opened' },
  { label: 'Email Clicked', id: 'loops_email_clicked' },
  { label: 'Email Hard Bounced', id: 'loops_email_hard_bounced' },
  { label: 'Email Soft Bounced', id: 'loops_email_soft_bounced' },
  { label: 'Campaign Email Sent', id: 'loops_campaign_email_sent' },
  { label: 'Loop Email Sent', id: 'loops_loop_email_sent' },
  { label: 'Transactional Email Sent', id: 'loops_transactional_email_sent' },
]

/**
 * Returns true if the incoming Loops webhook body matches the configured trigger.
 * Matches on the payload `eventName` field.
 */
export function isLoopsEventMatch(triggerId: string, body: Record<string, unknown>): boolean {
  const expected = LOOPS_TRIGGER_TO_EVENT_TYPE[triggerId]
  if (!expected) return false
  return (body?.eventName as string | undefined) === expected
}

/**
 * Generates setup instructions for manual Loops webhook configuration.
 * Loops webhooks are created in the Loops dashboard; the signing secret must be
 * pasted into the trigger configuration so Sim can verify the signature.
 */
export function loopsSetupInstructions(eventType: string): string {
  const instructions = [
    'Copy the <strong>Webhook URL</strong> above.',
    'In Loops, go to <a href="https://app.loops.so/settings?page=webhooks" target="_blank" rel="noopener noreferrer">Settings &gt; Webhooks</a> and click <strong>"Add endpoint"</strong>.',
    'Paste the <strong>Webhook URL</strong> into the endpoint URL field.',
    `Subscribe the endpoint to the <strong>${eventType}</strong> event.`,
    'Copy the endpoint <strong>Signing Secret</strong> from Loops and paste it into the <strong>Signing Secret</strong> field above.',
    'Click <strong>"Save"</strong> above to activate your trigger.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Builds Loops-specific extra fields. Includes the signing secret used to verify
 * the webhook signature (manual setup — pasted from the Loops dashboard).
 */
export function buildLoopsExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'signingSecret',
      title: 'Signing Secret',
      type: 'short-input',
      placeholder: 'Paste the Loops endpoint signing secret',
      description: 'Required to verify the webhook signature from Loops.',
      password: true,
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Outputs for Loops email tracking events (delivered, opened, clicked, hardBounced,
 * softBounced). All five engagement events share this payload shape.
 * @see https://loops.so/docs/webhooks
 */
export function buildLoopsOutputs(): Record<string, TriggerOutput> {
  return {
    eventName: {
      type: 'string',
      description: 'Event type (e.g., email.delivered, email.opened, email.clicked)',
    },
    eventTime: {
      type: 'number',
      description: 'Unix timestamp (seconds) when the event occurred',
    },
    webhookSchemaVersion: {
      type: 'string',
      description: 'Webhook schema version (e.g., "1.0.0")',
    },
    sourceType: {
      type: 'string',
      description: 'Source of the email: "campaign", "loop", or "transactional"',
    },
    campaignId: {
      type: 'string',
      description: 'Campaign ID, present when sourceType is "campaign"',
    },
    loopId: {
      type: 'string',
      description: 'Loop (workflow) ID, present when sourceType is "loop"',
    },
    transactionalId: {
      type: 'string',
      description: 'Transactional email ID, present when sourceType is "transactional"',
    },
    email: {
      type: 'json',
      description: 'Email object from the payload (id, emailMessageId, subject)',
    },
    emailId: {
      type: 'string',
      description: 'Unique email ID (payload `email.id`)',
    },
    emailMessageId: {
      type: 'string',
      description: 'Sent email message ID (payload `email.emailMessageId`)',
    },
    subject: {
      type: 'string',
      description: 'Email subject line (payload `email.subject`)',
    },
    contactIdentity: {
      type: 'json',
      description: 'Contact identity object from the payload (id, email, userId)',
    },
    contactId: {
      type: 'string',
      description: 'Contact ID (payload `contactIdentity.id`)',
    },
    contactEmail: {
      type: 'string',
      description: 'Contact email address (payload `contactIdentity.email`)',
    },
    userId: {
      type: 'string',
      description: 'Contact user ID, when set (payload `contactIdentity.userId`)',
    },
  }
}

/**
 * Outputs for Loops "sent" events (campaign.email.sent, loop.email.sent,
 * transactional.email.sent). These payloads omit `sourceType` and instead carry the
 * source name (`campaignName`/`loopName`) and, for campaign/loop sends, the resolved
 * `mailingLists` array.
 * @see https://loops.so/docs/webhooks
 */
export function buildLoopsSentOutputs(): Record<string, TriggerOutput> {
  return {
    eventName: {
      type: 'string',
      description:
        'Event type (e.g., campaign.email.sent, loop.email.sent, transactional.email.sent)',
    },
    eventTime: {
      type: 'number',
      description: 'Unix timestamp (seconds) when the event occurred',
    },
    webhookSchemaVersion: {
      type: 'string',
      description: 'Webhook schema version (e.g., "1.0.0")',
    },
    campaignId: {
      type: 'string',
      description: 'Campaign ID, present on campaign.email.sent',
    },
    campaignName: {
      type: 'string',
      description: 'Campaign name, present on campaign.email.sent',
    },
    loopId: {
      type: 'string',
      description: 'Loop (workflow) ID, present on loop.email.sent',
    },
    loopName: {
      type: 'string',
      description: 'Loop (workflow) name, present on loop.email.sent',
    },
    transactionalId: {
      type: 'string',
      description: 'Transactional email ID, present on transactional.email.sent',
    },
    email: {
      type: 'json',
      description: 'Email object from the payload (id, emailMessageId, subject)',
    },
    emailId: {
      type: 'string',
      description: 'Unique email ID (payload `email.id`)',
    },
    emailMessageId: {
      type: 'string',
      description: 'Sent email message ID (payload `email.emailMessageId`)',
    },
    subject: {
      type: 'string',
      description: 'Email subject line (payload `email.subject`)',
    },
    contactIdentity: {
      type: 'json',
      description: 'Contact identity object from the payload (id, email, userId)',
    },
    contactId: {
      type: 'string',
      description: 'Contact ID (payload `contactIdentity.id`)',
    },
    contactEmail: {
      type: 'string',
      description: 'Contact email address (payload `contactIdentity.email`)',
    },
    userId: {
      type: 'string',
      description: 'Contact user ID, when set (payload `contactIdentity.userId`)',
    },
    mailingLists: {
      type: 'json',
      description:
        'Mailing lists the send targeted (id, name, description, isPublic); present on campaign and loop sends',
    },
  }
}
