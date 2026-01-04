import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all Grain triggers
 */
export const grainTriggerOptions = [
  { label: 'General Webhook (All Events)', id: 'grain_webhook' },
  { label: 'Recording Created', id: 'grain_recording_created' },
  { label: 'Recording Updated', id: 'grain_recording_updated' },
  { label: 'Highlight Created', id: 'grain_highlight_created' },
  { label: 'Highlight Updated', id: 'grain_highlight_updated' },
  { label: 'Story Created', id: 'grain_story_created' },
]

/**
 * Generate setup instructions for a specific Grain event type
 */
export function grainSetupInstructions(eventType: string): string {
  const instructions = [
    'Enter your Grain API Key (Personal Access Token) above.',
    'You can find or create your API key in Grain at <strong>Settings > Integrations > API</strong>.',
    'Optionally configure filters to narrow which recordings trigger the webhook.',
    `Click <strong>"Save Configuration"</strong> to automatically create the webhook in Grain for <strong>${eventType}</strong> events.`,
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
 * Build output schema for recording events
 * Webhook payload structure: { type, user_id, data: { ...recording } }
 */
export function buildRecordingOutputs(): Record<string, TriggerOutput> {
  return {
    type: {
      type: 'string',
      description: 'Event type (recording_added)',
    },
    user_id: {
      type: 'string',
      description: 'User UUID who triggered the event',
    },
    data: {
      type: 'object',
      description: 'Recording data object',
    },
    'data.id': {
      type: 'string',
      description: 'Recording UUID',
    },
    'data.title': {
      type: 'string',
      description: 'Recording title',
    },
    'data.start_datetime': {
      type: 'string',
      description: 'ISO8601 start timestamp',
    },
    'data.end_datetime': {
      type: 'string',
      description: 'ISO8601 end timestamp',
    },
    'data.duration_ms': {
      type: 'number',
      description: 'Duration in milliseconds',
    },
    'data.media_type': {
      type: 'string',
      description: 'audio, transcript, or video',
    },
    'data.source': {
      type: 'string',
      description: 'Recording source (zoom, meet, teams, etc.)',
    },
    'data.url': {
      type: 'string',
      description: 'URL to view in Grain',
    },
    'data.thumbnail_url': {
      type: 'string',
      description: 'Thumbnail URL (nullable)',
    },
    'data.tags': {
      type: 'array',
      description: 'Array of tag strings',
    },
    'data.teams': {
      type: 'array',
      description: 'Teams the recording belongs to',
    },
    'data.meeting_type': {
      type: 'object',
      description: 'Meeting type info (nullable)',
    },
    'data.highlights': {
      type: 'array',
      description: 'Highlights (if configured in hook)',
    },
    'data.participants': {
      type: 'array',
      description: 'Participants (if configured in hook)',
    },
    'data.ai_summary': {
      type: 'object',
      description: 'AI summary (if configured in hook)',
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build output schema for highlight events
 * Note: Grain API docs only show recording webhooks. Highlight webhooks may have similar structure.
 */
export function buildHighlightOutputs(): Record<string, TriggerOutput> {
  return {
    type: {
      type: 'string',
      description: 'Event type',
    },
    user_id: {
      type: 'string',
      description: 'User UUID who triggered the event',
    },
    data: {
      type: 'object',
      description: 'Highlight data object',
    },
    'data.id': {
      type: 'string',
      description: 'Highlight UUID',
    },
    'data.recording_id': {
      type: 'string',
      description: 'Parent recording UUID',
    },
    'data.text': {
      type: 'string',
      description: 'Highlight title/description',
    },
    'data.transcript': {
      type: 'string',
      description: 'Transcript text of the clip',
    },
    'data.speakers': {
      type: 'array',
      description: 'Array of speaker names',
    },
    'data.timestamp': {
      type: 'number',
      description: 'Start timestamp in ms',
    },
    'data.duration': {
      type: 'number',
      description: 'Duration in ms',
    },
    'data.tags': {
      type: 'array',
      description: 'Array of tag strings',
    },
    'data.url': {
      type: 'string',
      description: 'URL to view in Grain',
    },
    'data.thumbnail_url': {
      type: 'string',
      description: 'Thumbnail URL',
    },
    'data.created_datetime': {
      type: 'string',
      description: 'ISO8601 creation timestamp',
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build output schema for story events
 * Note: Grain API docs only show recording webhooks. Story webhooks may have similar structure.
 */
export function buildStoryOutputs(): Record<string, TriggerOutput> {
  return {
    type: {
      type: 'string',
      description: 'Event type',
    },
    user_id: {
      type: 'string',
      description: 'User UUID who triggered the event',
    },
    data: {
      type: 'object',
      description: 'Story data object',
    },
    'data.id': {
      type: 'string',
      description: 'Story UUID',
    },
    'data.title': {
      type: 'string',
      description: 'Story title',
    },
    'data.url': {
      type: 'string',
      description: 'URL to view in Grain',
    },
    'data.created_datetime': {
      type: 'string',
      description: 'ISO8601 creation timestamp',
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build output schema for generic webhook events
 * Webhook payload structure: { type, user_id, data: { ... } }
 */
export function buildGenericOutputs(): Record<string, TriggerOutput> {
  return {
    type: {
      type: 'string',
      description: 'Event type (e.g., recording_added)',
    },
    user_id: {
      type: 'string',
      description: 'User UUID who triggered the event',
    },
    data: {
      type: 'object',
      description: 'Event data object (recording, highlight, etc.)',
    },
  } as Record<string, TriggerOutput>
}
