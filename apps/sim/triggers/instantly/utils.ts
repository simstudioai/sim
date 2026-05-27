import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

export const INSTANTLY_TRIGGER_TO_EVENT_TYPE = {
  instantly_webhook: 'all_events',
  instantly_email_sent: 'email_sent',
  instantly_email_opened: 'email_opened',
  instantly_reply_received: 'reply_received',
  instantly_auto_reply_received: 'auto_reply_received',
  instantly_link_clicked: 'link_clicked',
  instantly_email_bounced: 'email_bounced',
  instantly_lead_unsubscribed: 'lead_unsubscribed',
  instantly_account_error: 'account_error',
  instantly_campaign_completed: 'campaign_completed',
  instantly_lead_neutral: 'lead_neutral',
  instantly_lead_interested: 'lead_interested',
  instantly_lead_not_interested: 'lead_not_interested',
  instantly_lead_meeting_booked: 'lead_meeting_booked',
  instantly_lead_meeting_completed: 'lead_meeting_completed',
  instantly_lead_closed: 'lead_closed',
  instantly_lead_out_of_office: 'lead_out_of_office',
  instantly_lead_wrong_person: 'lead_wrong_person',
  instantly_lead_no_show: 'lead_no_show',
  instantly_supersearch_enrichment_completed: 'supersearch_enrichment_completed',
} as const

export const INSTANTLY_TRIGGER_TO_SUBSCRIPTION_EVENT_TYPE = {
  ...INSTANTLY_TRIGGER_TO_EVENT_TYPE,
  instantly_auto_reply_received: 'all_events',
  instantly_link_clicked: 'email_link_clicked',
} as const

export const instantlyTriggerOptions = [
  { label: 'All Events', id: 'instantly_webhook' },
  { label: 'Email Sent', id: 'instantly_email_sent' },
  { label: 'Email Opened', id: 'instantly_email_opened' },
  { label: 'Reply Received', id: 'instantly_reply_received' },
  { label: 'Auto Reply Received', id: 'instantly_auto_reply_received' },
  { label: 'Link Clicked', id: 'instantly_link_clicked' },
  { label: 'Email Bounced', id: 'instantly_email_bounced' },
  { label: 'Lead Unsubscribed', id: 'instantly_lead_unsubscribed' },
  { label: 'Account Error', id: 'instantly_account_error' },
  { label: 'Campaign Completed', id: 'instantly_campaign_completed' },
  { label: 'Lead Neutral', id: 'instantly_lead_neutral' },
  { label: 'Lead Interested', id: 'instantly_lead_interested' },
  { label: 'Lead Not Interested', id: 'instantly_lead_not_interested' },
  { label: 'Lead Meeting Booked', id: 'instantly_lead_meeting_booked' },
  { label: 'Lead Meeting Completed', id: 'instantly_lead_meeting_completed' },
  { label: 'Lead Closed', id: 'instantly_lead_closed' },
  { label: 'Lead Out Of Office', id: 'instantly_lead_out_of_office' },
  { label: 'Lead Wrong Person', id: 'instantly_lead_wrong_person' },
  { label: 'Lead No Show', id: 'instantly_lead_no_show' },
  {
    label: 'Supersearch Enrichment Completed',
    id: 'instantly_supersearch_enrichment_completed',
  },
]

export function instantlySetupInstructions(eventType: string): string {
  const instructions = [
    'Enter an <strong>Instantly API Key</strong> with webhook create/delete permissions.',
    'Optionally enter a <strong>Campaign ID</strong> to receive only events for that campaign.',
    `Click <strong>Save Configuration</strong> to automatically create an Instantly webhook for <strong>${eventType}</strong>.`,
    'The webhook will be automatically deleted from Instantly when this trigger is removed.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

export function buildInstantlyExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'triggerApiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Instantly API key',
      password: true,
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'triggerCampaignId',
      title: 'Campaign ID (Optional)',
      type: 'short-input',
      placeholder: 'Leave empty for all campaigns',
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

export function buildInstantlyOutputs(): Record<string, TriggerOutput> {
  return {
    timestamp: { type: 'string', description: 'ISO timestamp when the event occurred' },
    eventType: { type: 'string', description: 'Instantly webhook event type' },
    workspace: { type: 'string', description: 'Instantly workspace UUID' },
    campaignId: { type: 'string', description: 'Instantly campaign UUID' },
    campaignName: { type: 'string', description: 'Instantly campaign name' },
    leadEmail: { type: 'string', description: 'Lead email address' },
    emailAccount: { type: 'string', description: 'Email account used to send the message' },
    uniboxUrl: { type: 'string', description: 'URL to view the conversation in Unibox' },
    step: { type: 'number', description: 'Campaign step number, starting at 1' },
    variant: { type: 'number', description: 'Campaign step variant number, starting at 1' },
    isFirst: { type: 'boolean', description: 'Whether this is the first event of this type' },
    emailId: { type: 'string', description: 'Email ID, usable as reply_to_uuid' },
    emailSubject: { type: 'string', description: 'Sent email subject' },
    emailText: { type: 'string', description: 'Sent email plain-text content' },
    emailHtml: { type: 'string', description: 'Sent email HTML content' },
    replyTextSnippet: { type: 'string', description: 'Short preview of the reply content' },
    replySubject: { type: 'string', description: 'Reply email subject' },
    replyText: { type: 'string', description: 'Full plain-text reply content' },
    replyHtml: { type: 'string', description: 'Full HTML reply content' },
    payload: {
      type: 'json',
      description: 'Full Instantly webhook payload, including any extra lead data fields',
    },
  }
}

export function getInstantlyEventTypeForTrigger(triggerId: string): string | undefined {
  return INSTANTLY_TRIGGER_TO_EVENT_TYPE[triggerId as keyof typeof INSTANTLY_TRIGGER_TO_EVENT_TYPE]
}

export function getInstantlySubscriptionEventTypeForTrigger(triggerId: string): string | undefined {
  return INSTANTLY_TRIGGER_TO_SUBSCRIPTION_EVENT_TYPE[
    triggerId as keyof typeof INSTANTLY_TRIGGER_TO_SUBSCRIPTION_EVENT_TYPE
  ]
}

export function isInstantlyEventMatch(triggerId: string, body: Record<string, unknown>): boolean {
  if (triggerId === 'instantly_webhook') return true

  const expectedEventType = getInstantlyEventTypeForTrigger(triggerId)
  if (!expectedEventType) return false

  const actualEventType = body.event_type
  if (typeof actualEventType !== 'string') return false

  if (triggerId === 'instantly_link_clicked') {
    return actualEventType === 'link_clicked' || actualEventType === 'email_link_clicked'
  }

  return actualEventType === expectedEventType
}
