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
    'You can find your API key in Lemlist at <strong>Settings > Integrations</strong>. See the <a href="https://help.lemlist.com/en/articles/4452694-find-and-use-the-lemlist-api" target="_blank" rel="noopener noreferrer">Lemlist API documentation</a> for details.',
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
 * Core fields present in ALL Lemlist webhook payloads
 * See: https://help.lemlist.com/en/articles/9423940-use-the-api-to-list-activity-types
 */
const coreOutputs = {
  _id: {
    type: 'string',
    description: 'Unique activity identifier',
  },
  type: {
    type: 'string',
    description: 'Activity type (e.g., emailsSent, emailsReplied)',
  },
  createdAt: {
    type: 'string',
    description: 'Activity creation timestamp (ISO 8601)',
  },
  teamId: {
    type: 'string',
    description: 'Lemlist team identifier',
  },
} as const

/**
 * Campaign-related fields - only present when activity is part of a campaign
 * These may be missing for first replies or activities outside campaign context
 */
const campaignOutputs = {
  leadId: {
    type: 'string',
    description: 'Lead identifier (only present for campaign activities)',
  },
  campaignId: {
    type: 'string',
    description: 'Campaign identifier (only present for campaign activities)',
  },
  campaignName: {
    type: 'string',
    description: 'Campaign name (only present for campaign activities)',
  },
} as const

/**
 * Lead fields present in webhook payloads
 */
const leadOutputs = {
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
  linkedinUrl: {
    type: 'string',
    description: 'Lead LinkedIn profile URL',
  },
} as const

/**
 * Sequence/campaign tracking fields for email activities
 */
const sequenceOutputs = {
  sequenceId: {
    type: 'string',
    description: 'Sequence identifier',
  },
  sequenceStep: {
    type: 'number',
    description: 'Current step in the sequence (0-indexed)',
  },
  totalSequenceStep: {
    type: 'number',
    description: 'Total number of steps in the sequence',
  },
  isFirst: {
    type: 'boolean',
    description: 'Whether this is the first activity of this type for this step',
  },
} as const

/**
 * Sender information fields
 */
const senderOutputs = {
  sendUserId: {
    type: 'string',
    description: 'Sender user identifier',
  },
  sendUserEmail: {
    type: 'string',
    description: 'Sender email address',
  },
  sendUserName: {
    type: 'string',
    description: 'Sender display name',
  },
} as const

/**
 * Email content fields
 */
const emailContentOutputs = {
  subject: {
    type: 'string',
    description: 'Email subject line',
  },
  text: {
    type: 'string',
    description: 'Email body content (HTML)',
  },
  messageId: {
    type: 'string',
    description: 'Email message ID (RFC 2822 format)',
  },
  emailId: {
    type: 'string',
    description: 'Lemlist email identifier',
  },
} as const

/**
 * Build outputs for email sent events
 */
export function buildEmailSentOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    ...campaignOutputs,
    ...leadOutputs,
    ...sequenceOutputs,
    ...senderOutputs,
    ...emailContentOutputs,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for email replied events
 */
export function buildEmailRepliedOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    ...campaignOutputs,
    ...leadOutputs,
    ...sequenceOutputs,
    ...senderOutputs,
    ...emailContentOutputs,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for email opened events
 */
export function buildEmailOpenedOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    ...campaignOutputs,
    ...leadOutputs,
    ...sequenceOutputs,
    ...senderOutputs,
    messageId: {
      type: 'string',
      description: 'Email message ID that was opened',
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for email clicked events
 */
export function buildEmailClickedOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    ...campaignOutputs,
    ...leadOutputs,
    ...sequenceOutputs,
    ...senderOutputs,
    messageId: {
      type: 'string',
      description: 'Email message ID containing the clicked link',
    },
    clickedUrl: {
      type: 'string',
      description: 'URL that was clicked',
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for email bounced events
 */
export function buildEmailBouncedOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    ...campaignOutputs,
    ...leadOutputs,
    ...sequenceOutputs,
    ...senderOutputs,
    messageId: {
      type: 'string',
      description: 'Email message ID that bounced',
    },
    errorMessage: {
      type: 'string',
      description: 'Bounce error message',
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for LinkedIn replied events
 */
export function buildLinkedInRepliedOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    ...campaignOutputs,
    ...leadOutputs,
    ...sequenceOutputs,
    text: {
      type: 'string',
      description: 'LinkedIn message content',
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for interested/not interested events
 */
export function buildInterestOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    ...campaignOutputs,
    ...leadOutputs,
    ...sequenceOutputs,
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for generic webhook (all events)
 * Includes all possible fields across event types
 */
export function buildLemlistOutputs(): Record<string, TriggerOutput> {
  return {
    ...coreOutputs,
    ...campaignOutputs,
    ...leadOutputs,
    ...sequenceOutputs,
    ...senderOutputs,
    ...emailContentOutputs,
    clickedUrl: {
      type: 'string',
      description: 'URL that was clicked (for emailsClicked events)',
    },
    errorMessage: {
      type: 'string',
      description: 'Error message (for bounce/failed events)',
    },
  } as Record<string, TriggerOutput>
}
