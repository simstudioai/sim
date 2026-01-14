import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all Lemlist triggers
 */
export const lemlistTriggerOptions = [
  { label: 'Email Replied', id: 'lemlist_email_replied' },
  { label: 'LinkedIn Replied', id: 'lemlist_linkedin_replied' },
  { label: 'Lead Interested', id: 'lemlist_interested' },
  { label: 'Lead Not Interested', id: 'lemlist_not_interested' },
  { label: 'Email Opened', id: 'lemlist_email_opened' },
  { label: 'Email Clicked', id: 'lemlist_email_clicked' },
  { label: 'Email Bounced', id: 'lemlist_email_bounced' },
  { label: 'Email Sent', id: 'lemlist_email_sent' },
  { label: 'Generic Webhook (All Events)', id: 'lemlist_webhook' },
]

/**
 * Generates setup instructions for Lemlist webhooks
 * The webhook is automatically created in Lemlist when you save
 */
export function lemlistSetupInstructions(eventType: string): string {
  const instructions = [
    'Enter your Lemlist API Key above.',
    'You can find your API key in Lemlist at <strong>Settings > Integrations > API</strong>.',
    `Click <strong>"Save Configuration"</strong> to automatically create the webhook in Lemlist for <strong>${eventType}</strong> events.`,
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
 * Helper to build Lemlist-specific extra fields.
 * Includes API key (required) and optional campaign filter.
 * Use with the generic buildTriggerSubBlocks from @/triggers.
 */
export function buildLemlistExtraFields(triggerId: string) {
  return [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input' as const,
      placeholder: 'Enter your Lemlist API key',
      description: 'Required to create the webhook in Lemlist.',
      password: true,
      required: true,
      mode: 'trigger' as const,
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'campaignId',
      title: 'Campaign ID (Optional)',
      type: 'short-input' as const,
      placeholder: 'cam_xxxxx (leave empty for all campaigns)',
      description: 'Optionally scope the webhook to a specific campaign',
      mode: 'trigger' as const,
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Lemlist webhook outputs - exposes raw payload as `data` object
 * Users can access any field via data.fieldName (e.g., data.type, data.leadEmail)
 *
 * Common fields in Lemlist webhooks include:
 * - _id, type, createdAt, teamId, leadId, campaignId
 * - leadEmail, leadFirstName, leadLastName, leadCompanyName, leadPhone, leadPicture
 * - name (campaign name), sequenceId, sequenceStep, totalSequenceStep
 * - sendUserId, sendUserEmail, sendUserName, sendUserMailboxId
 * - messageId, emailId, emailTemplateId, isFirst, relatedSentAt
 * - text, message (for replies)
 *
 * See Lemlist API docs for complete field reference:
 * https://help.lemlist.com/en/articles/9423940-api-get-activities-list-of-activities-type
 */
export function buildLemlistOutputs(): Record<string, TriggerOutput> {
  return {
    data: {
      type: 'json',
      description: 'Raw webhook payload from Lemlist (access fields via data.fieldName)',
    },
  }
}
