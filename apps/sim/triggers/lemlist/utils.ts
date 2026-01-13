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
 * Base activity outputs shared across all Lemlist triggers
 */
function buildBaseActivityOutputs(): Record<string, TriggerOutput> {
  return {
    type: {
      type: 'string',
      description: 'Activity type (emailsReplied, linkedinReplied, interested, emailsOpened, etc.)',
    },
    _id: {
      type: 'string',
      description: 'Unique activity identifier',
    },
    leadId: {
      type: 'string',
      description: 'Associated lead ID',
    },
    campaignId: {
      type: 'string',
      description: 'Campaign ID',
    },
    campaignName: {
      type: 'string',
      description: 'Campaign name',
    },
    sequenceId: {
      type: 'string',
      description: 'Sequence ID within the campaign',
    },
    stepId: {
      type: 'string',
      description: 'Step ID that triggered this activity',
    },
    createdAt: {
      type: 'string',
      description: 'When the activity occurred (ISO 8601)',
    },
  }
}

/**
 * Lead outputs - information about the lead
 */
function buildLeadOutputs(): Record<string, TriggerOutput> {
  return {
    lead: {
      _id: {
        type: 'string',
        description: 'Lead unique identifier',
      },
      email: {
        type: 'string',
        description: 'Lead email address',
      },
      firstName: {
        type: 'string',
        description: 'Lead first name',
      },
      lastName: {
        type: 'string',
        description: 'Lead last name',
      },
      companyName: {
        type: 'string',
        description: 'Lead company name',
      },
      phone: {
        type: 'string',
        description: 'Lead phone number',
      },
      linkedinUrl: {
        type: 'string',
        description: 'Lead LinkedIn profile URL',
      },
      picture: {
        type: 'string',
        description: 'Lead profile picture URL',
      },
      icebreaker: {
        type: 'string',
        description: 'Personalized icebreaker text',
      },
      timezone: {
        type: 'string',
        description: 'Lead timezone (e.g., America/New_York)',
      },
      isUnsubscribed: {
        type: 'boolean',
        description: 'Whether the lead is unsubscribed',
      },
    },
  }
}

/**
 * Standard activity outputs (activity + lead data)
 */
export function buildActivityOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseActivityOutputs(),
    ...buildLeadOutputs(),
    webhook: {
      type: 'json',
      description: 'Full webhook payload with all activity-specific data',
    },
  }
}

/**
 * Email-specific outputs (includes message content for replies)
 */
export function buildEmailReplyOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseActivityOutputs(),
    ...buildLeadOutputs(),
    messageId: {
      type: 'string',
      description: 'Email message ID',
    },
    subject: {
      type: 'string',
      description: 'Email subject line',
    },
    text: {
      type: 'string',
      description: 'Email reply text content',
    },
    html: {
      type: 'string',
      description: 'Email reply HTML content',
    },
    sentAt: {
      type: 'string',
      description: 'When the reply was sent',
    },
    webhook: {
      type: 'json',
      description: 'Full webhook payload with all email data',
    },
  }
}

/**
 * LinkedIn-specific outputs (includes message content)
 */
export function buildLinkedInReplyOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseActivityOutputs(),
    ...buildLeadOutputs(),
    messageId: {
      type: 'string',
      description: 'LinkedIn message ID',
    },
    text: {
      type: 'string',
      description: 'LinkedIn message text content',
    },
    sentAt: {
      type: 'string',
      description: 'When the message was sent',
    },
    webhook: {
      type: 'json',
      description: 'Full webhook payload with all LinkedIn data',
    },
  }
}

/**
 * All outputs for generic webhook (activity + lead + all possible fields)
 */
export function buildAllOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseActivityOutputs(),
    ...buildLeadOutputs(),
    messageId: {
      type: 'string',
      description: 'Message ID (for email/LinkedIn events)',
    },
    subject: {
      type: 'string',
      description: 'Email subject (for email events)',
    },
    text: {
      type: 'string',
      description: 'Message text content',
    },
    html: {
      type: 'string',
      description: 'Message HTML content (for email events)',
    },
    sentAt: {
      type: 'string',
      description: 'When the message was sent',
    },
    webhook: {
      type: 'json',
      description: 'Full webhook payload with all data',
    },
  }
}
