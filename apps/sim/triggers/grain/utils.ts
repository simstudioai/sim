import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Hook types each v2 trigger subscribes to on the Grain v2 hooks API. One
 * external hook is created per hook type (v2 has no multi-event hooks), so the
 * All Events trigger owns one hook per type.
 */
export const GRAIN_V2_TRIGGER_TO_HOOK_TYPES = {
  grain_recording_added_v2: ['recording_added'],
  grain_recording_updated_v2: ['recording_updated'],
  grain_recording_deleted_v2: ['recording_deleted'],
  grain_highlight_added_v2: ['highlight_added'],
  grain_highlight_updated_v2: ['highlight_updated'],
  grain_highlight_deleted_v2: ['highlight_deleted'],
  grain_story_added_v2: ['story_added'],
  grain_story_updated_v2: ['story_updated'],
  grain_story_deleted_v2: ['story_deleted'],
  grain_upload_status_v2: ['upload_status'],
  grain_all_events_v2: [
    'recording_added',
    'recording_updated',
    'recording_deleted',
    'highlight_added',
    'highlight_updated',
    'highlight_deleted',
    'story_added',
    'story_updated',
    'story_deleted',
    'upload_status',
  ],
} as const

export const grainV2TriggerOptions = [
  { label: 'Recording Added', id: 'grain_recording_added_v2' },
  { label: 'Recording Updated', id: 'grain_recording_updated_v2' },
  { label: 'Recording Deleted', id: 'grain_recording_deleted_v2' },
  { label: 'Highlight Added', id: 'grain_highlight_added_v2' },
  { label: 'Highlight Updated', id: 'grain_highlight_updated_v2' },
  { label: 'Highlight Deleted', id: 'grain_highlight_deleted_v2' },
  { label: 'Story Added', id: 'grain_story_added_v2' },
  { label: 'Story Updated', id: 'grain_story_updated_v2' },
  { label: 'Story Deleted', id: 'grain_story_deleted_v2' },
  { label: 'Upload Status', id: 'grain_upload_status_v2' },
  { label: 'All Events', id: 'grain_all_events_v2' },
]

/** Hook type options for the Create Webhook operation dropdown. */
export const GRAIN_HOOK_TYPE_OPTIONS = [
  { label: 'Recording Added', id: 'recording_added' },
  { label: 'Recording Updated', id: 'recording_updated' },
  { label: 'Recording Deleted', id: 'recording_deleted' },
  { label: 'Highlight Added', id: 'highlight_added' },
  { label: 'Highlight Updated', id: 'highlight_updated' },
  { label: 'Highlight Deleted', id: 'highlight_deleted' },
  { label: 'Story Added', id: 'story_added' },
  { label: 'Story Updated', id: 'story_updated' },
  { label: 'Story Deleted', id: 'story_deleted' },
  { label: 'Upload Status', id: 'upload_status' },
]

/**
 * Setup instructions for the v2 event triggers.
 */
export function grainV2EventSetupInstructions(eventLabel: string): string {
  const webhookSentence =
    eventLabel === 'All Events'
      ? 'Grain creates one webhook per event type when you deploy, and deletes them when this trigger is removed.'
      : `Grain creates a <strong>${eventLabel}</strong> webhook when you deploy, and deletes it when this trigger is removed.`

  const instructions = [
    'Enter your Grain API Key (Personal or Workspace Access Token). You can find or create one in Grain at <strong>Workspace Settings &gt; API</strong> under Integrations on <a href="https://grain.com/app/settings/integrations?tab=api" target="_blank" rel="noopener noreferrer">grain.com</a>.',
    webhookSentence,
    'Place additional Grain trigger blocks to react to other event types.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Shared credential field for the v2 event triggers.
 */
export function buildGrainV2ExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Grain API key',
      description: 'Required to create the webhook in Grain.',
      password: true,
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

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
