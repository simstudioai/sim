import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all Fathom triggers
 */
export const fathomTriggerOptions = [
  { label: 'New Meeting Content', id: 'fathom_new_meeting' },
  { label: 'General Webhook (All Events)', id: 'fathom_webhook' },
]

/**
 * Generate setup instructions for a specific Fathom event type
 */
export function fathomSetupInstructions(eventType: string): string {
  const instructions = [
    'Enter your Fathom API Key above.',
    'You can find or create your API key in Fathom at <strong>Settings > Integrations > API</strong>. See the <a href="https://developers.fathom.ai/" target="_blank" rel="noopener noreferrer">Fathom API documentation</a> for details.',
    `Click <strong>"Save Configuration"</strong> to automatically create the webhook in Fathom for <strong>${eventType}</strong> events.`,
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
 * Build output schema for meeting content events.
 * Fathom webhook payload delivers meeting data including summary, transcript, and action items
 * based on the include flags set during webhook creation.
 */
export function buildMeetingOutputs(): Record<string, TriggerOutput> {
  return {
    title: {
      type: 'string',
      description: 'Meeting title',
    },
    meeting_title: {
      type: 'string',
      description: 'Calendar event title',
    },
    recording_id: {
      type: 'number',
      description: 'Unique recording ID',
    },
    url: {
      type: 'string',
      description: 'URL to view the meeting in Fathom',
    },
    share_url: {
      type: 'string',
      description: 'Shareable URL for the meeting',
    },
    created_at: {
      type: 'string',
      description: 'ISO 8601 creation timestamp',
    },
    scheduled_start_time: {
      type: 'string',
      description: 'Scheduled start time',
    },
    scheduled_end_time: {
      type: 'string',
      description: 'Scheduled end time',
    },
    recording_start_time: {
      type: 'string',
      description: 'Recording start time',
    },
    recording_end_time: {
      type: 'string',
      description: 'Recording end time',
    },
    transcript_language: {
      type: 'string',
      description: 'Language of the transcript',
    },
    calendar_invitees_domains_type: {
      type: 'string',
      description: 'Domain type: only_internal or one_or_more_external',
    },
    recorded_by: {
      type: 'object',
      description: 'Recorder details',
      name: { type: 'string', description: 'Name of the recorder' },
      email: { type: 'string', description: 'Email of the recorder' },
    },
    calendar_invitees: {
      type: 'array',
      description: 'Array of calendar invitees with name and email',
    },
    default_summary: {
      type: 'object',
      description: 'Meeting summary',
      template_name: { type: 'string', description: 'Summary template name' },
      markdown_formatted: { type: 'string', description: 'Markdown-formatted summary' },
    },
    transcript: {
      type: 'array',
      description: 'Array of transcript entries with speaker, text, and timestamp',
    },
    action_items: {
      type: 'array',
      description: 'Array of action items extracted from the meeting',
    },
    crm_matches: {
      type: 'json',
      description: 'Matched CRM contacts, companies, and deals from linked CRM',
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build output schema for generic webhook events.
 * Fathom only has one webhook event type (new meeting content ready) and the payload
 * is the Meeting object directly (no wrapping), so outputs match buildMeetingOutputs.
 */
export function buildGenericOutputs(): Record<string, TriggerOutput> {
  return buildMeetingOutputs()
}
