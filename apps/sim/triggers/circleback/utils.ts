import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all Circleback triggers
 */
export const circlebackTriggerOptions = [
  { label: 'General Webhook', id: 'circleback_webhook' },
  { label: 'Meeting Completed', id: 'circleback_meeting_completed' },
  { label: 'Meeting Notes Ready', id: 'circleback_meeting_notes' },
]

/**
 * Generate setup instructions for a specific Circleback event type
 */
export function circlebackSetupInstructions(eventType: string): string {
  const instructions = [
    '<strong>Note:</strong> You need access to Circleback automations to set up webhooks. See the <a href="https://circleback.ai/docs/webhook-integration" target="_blank" rel="noopener noreferrer">Circleback webhook documentation</a> for details.',
    'In Circleback, click <strong>Automations</strong> in the sidebar.',
    'Create a new automation or edit an existing one.',
    'Add a <strong>Send webhook request</strong> step to your automation.',
    'Paste the <strong>Webhook URL</strong> from above into the Endpoint field.',
    'Optionally, copy the <strong>Signing Secret</strong> from Circleback and paste it above to verify webhook signatures.',
    `Toggle what to include in the request (Meeting notes, Action items, Transcript). For this trigger: <strong>${eventType}</strong>.`,
    'Click <strong>"Done"</strong> and save the automation.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3">${index === 0 ? instruction : `<strong>${index}.</strong> ${instruction}`}</div>`
    )
    .join('')
}

/**
 * Build output schema for meeting events
 */
export function buildMeetingOutputs(): Record<string, TriggerOutput> {
  return {
    id: {
      type: 'number',
      description: 'Circleback meeting ID',
    },
    name: {
      type: 'string',
      description: 'Meeting title/name',
    },
    url: {
      type: 'string',
      description: 'URL of the virtual meeting (Zoom, Google Meet, Teams, etc.)',
    },
    createdAt: {
      type: 'string',
      description: 'ISO8601 timestamp when meeting was created',
    },
    duration: {
      type: 'number',
      description: 'Meeting duration in seconds',
    },
    recordingUrl: {
      type: 'string',
      description: 'Recording URL (valid for 24 hours, if enabled)',
    },
    tags: {
      type: 'array',
      description: 'Array of tag strings',
    },
    icalUid: {
      type: 'string',
      description: 'Calendar event identifier',
    },
    attendees: {
      type: 'array',
      description: 'Array of attendee objects with name and email',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Attendee name' },
          email: { type: 'string', description: 'Attendee email address' },
        },
      },
    },
    notes: {
      type: 'string',
      description: 'Meeting notes in Markdown format',
    },
    actionItems: {
      type: 'array',
      description: 'Array of action item objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Action item ID' },
          title: { type: 'string', description: 'Action item title' },
          description: { type: 'string', description: 'Action item description' },
          assignee: {
            type: 'object',
            description: 'Person assigned to the action item (or null)',
            properties: {
              name: { type: 'string', description: 'Assignee name' },
              email: { type: 'string', description: 'Assignee email' },
            },
          },
          status: { type: 'string', description: 'Status: PENDING or DONE' },
        },
      },
    },
    transcript: {
      type: 'array',
      description: 'Array of transcript segments',
      items: {
        type: 'object',
        properties: {
          speaker: { type: 'string', description: 'Speaker name' },
          text: { type: 'string', description: 'Transcript text' },
          timestamp: { type: 'number', description: 'Timestamp in seconds' },
        },
      },
    },
    insights: {
      type: 'object',
      description: 'User-created insights keyed by insight name',
    },
    meeting: {
      type: 'object',
      description: 'Full meeting payload object',
      properties: {
        id: { type: 'number', description: 'Meeting ID' },
        name: { type: 'string', description: 'Meeting name' },
        url: { type: 'string', description: 'Meeting URL' },
        duration: { type: 'number', description: 'Duration in seconds' },
        createdAt: { type: 'string', description: 'Creation timestamp' },
        recordingUrl: { type: 'string', description: 'Recording URL' },
      },
    },
  } as any
}
