import type { TriggerOutput } from '@/triggers/types'

/**
 * Trigger dropdown options for Grain triggers.
 * New options (Item Added / Item Updated / All Events) correctly scope by view_id only.
 * Legacy options are hidden from the picker but still resolve for existing workflows.
 */
export const grainTriggerOptions = [
  { label: 'Item Added', id: 'grain_item_added' },
  { label: 'Item Updated', id: 'grain_item_updated' },
  { label: 'All Events', id: 'grain_webhook' },
  { label: 'Recording Created', id: 'grain_recording_created', hidden: true },
  { label: 'Recording Updated', id: 'grain_recording_updated', hidden: true },
  { label: 'Highlight Created', id: 'grain_highlight_created', hidden: true },
  { label: 'Highlight Updated', id: 'grain_highlight_updated', hidden: true },
  { label: 'Story Created', id: 'grain_story_created', hidden: true },
]

/**
 * Generate setup instructions for a specific Grain event type
 */
export function grainSetupInstructions(eventType: string): string {
  const instructions = [
    'Enter your Grain API Key (Personal Access Token) above.',
    `Enter the Grain view ID that matches the ${eventType} trigger. Grain requires <code>view_id</code> for webhook creation.`,
    'Use the Grain "List Views" tool or GET <code>/_/public-api/views</code> to find the correct view ID.',
    'You can find or create your API key in Grain at <strong>Workspace Settings > API</strong> under Integrations on <a href="https://grain.com/app/settings/integrations?tab=api" target="_blank" rel="noopener noreferrer">grain.com</a>.',
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
 * Setup instructions for the v2 triggers that correctly explain view-based scoping.
 */
export function grainV2SetupInstructions(action: 'item added' | 'item updated' | 'all'): string {
  const viewSentence =
    action === 'all'
      ? 'Enter a Grain <strong>view ID</strong>. Each view has a type &mdash; <em>recordings</em>, <em>highlights</em>, or <em>stories</em> &mdash; and this trigger will fire on every event (added, updated, or removed) for items in that view.'
      : `Enter a Grain <strong>view ID</strong>. Each view has a type &mdash; <em>recordings</em>, <em>highlights</em>, or <em>stories</em> &mdash; and only items matching that type will fire the <strong>${action}</strong> event.`

  const instructions = [
    'Enter your Grain API Key (Personal Access Token). You can find or create one in Grain at <strong>Workspace Settings &gt; API</strong> under Integrations on <a href="https://grain.com/app/settings/integrations?tab=api" target="_blank" rel="noopener noreferrer">grain.com</a>.',
    viewSentence,
    'To find your view IDs, use the <strong>List Views</strong> operation on this block or call <code>GET /_/public-api/views</code> directly.',
    'The webhook is created automatically when you save and will be deleted when you remove this trigger.',
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
      description: 'Event type',
    },
    user_id: {
      type: 'string',
      description: 'User UUID who triggered the event',
    },
    data: {
      id: {
        type: 'string',
        description: 'Recording UUID',
      },
      title: {
        type: 'string',
        description: 'Recording title',
      },
      start_datetime: {
        type: 'string',
        description: 'ISO8601 start timestamp',
      },
      end_datetime: {
        type: 'string',
        description: 'ISO8601 end timestamp',
      },
      duration_ms: {
        type: 'number',
        description: 'Duration in milliseconds',
      },
      media_type: {
        type: 'string',
        description: 'audio, transcript, or video',
      },
      source: {
        type: 'string',
        description: 'Recording source (zoom, meet, local_capture, etc.)',
      },
      url: {
        type: 'string',
        description: 'URL to view in Grain',
      },
      thumbnail_url: {
        type: 'string',
        description: 'Thumbnail URL (nullable)',
      },
      tags: {
        type: 'array',
        description: 'Array of tag strings',
      },
      teams: {
        type: 'array',
        description: 'Array of team objects',
      },
      meeting_type: {
        type: 'object',
        description: 'Meeting type info with id, name, scope (nullable)',
      },
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
      id: {
        type: 'string',
        description: 'Highlight UUID',
      },
      recording_id: {
        type: 'string',
        description: 'Parent recording UUID',
      },
      text: {
        type: 'string',
        description: 'Highlight title/description',
      },
      transcript: {
        type: 'string',
        description: 'Transcript text of the clip',
      },
      speakers: {
        type: 'array',
        description: 'Array of speaker names',
      },
      timestamp: {
        type: 'number',
        description: 'Start timestamp in ms',
      },
      duration: {
        type: 'number',
        description: 'Duration in ms',
      },
      tags: {
        type: 'array',
        description: 'Array of tag strings',
      },
      url: {
        type: 'string',
        description: 'URL to view in Grain',
      },
      thumbnail_url: {
        type: 'string',
        description: 'Thumbnail URL',
      },
      created_datetime: {
        type: 'string',
        description: 'ISO8601 creation timestamp',
      },
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
      id: {
        type: 'string',
        description: 'Story UUID',
      },
      title: {
        type: 'string',
        description: 'Story title',
      },
      url: {
        type: 'string',
        description: 'URL to view in Grain',
      },
      created_datetime: {
        type: 'string',
        description: 'ISO8601 creation timestamp',
      },
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
