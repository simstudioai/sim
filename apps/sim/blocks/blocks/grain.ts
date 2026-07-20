import { GrainIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'
import { GRAIN_HOOK_TYPE_OPTIONS, grainTriggerOptions } from '@/triggers/grain/utils'

const GRAIN_V2_TRIGGER_IDS = [
  'grain_recording_added_v2',
  'grain_recording_updated_v2',
  'grain_recording_deleted_v2',
  'grain_highlight_added_v2',
  'grain_highlight_updated_v2',
  'grain_highlight_deleted_v2',
  'grain_story_added_v2',
  'grain_story_updated_v2',
  'grain_story_deleted_v2',
  'grain_upload_status_v2',
  'grain_all_events_v2',
] as const

export const GrainBlock: BlockConfig = {
  type: 'grain',
  name: 'Grain',
  description: 'Access meeting recordings, transcripts, and AI summaries',
  authMode: AuthMode.ApiKey,
  triggerAllowed: true,
  // Superseded by grain_v2 (Grain API v1 sunsets 2026-09-07); existing blocks
  // keep rendering, new blocks come from the v2 entry.
  hideFromToolbar: true,
  longDescription:
    'Integrate Grain into your workflow. Access meeting recordings, transcripts, highlights, and AI-generated summaries. Can also trigger workflows based on Grain webhook events.',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  docsLink: 'https://docs.sim.ai/integrations/grain',
  icon: GrainIcon,
  bgColor: '#F6FAF9',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Recordings', id: 'grain_list_recordings' },
        { label: 'Get Recording', id: 'grain_get_recording' },
        { label: 'Get Transcript', id: 'grain_get_transcript' },
        { label: 'List Views', id: 'grain_list_views' },
        { label: 'List Teams', id: 'grain_list_teams' },
        { label: 'List Meeting Types', id: 'grain_list_meeting_types' },
        { label: 'Create Webhook', id: 'grain_create_hook' },
        { label: 'List Webhooks', id: 'grain_list_hooks' },
        { label: 'Delete Webhook', id: 'grain_delete_hook' },
      ],
      value: () => 'grain_list_recordings',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Grain API key',
      password: true,
      required: true,
    },
    // Recording ID (for get_recording and get_transcript)
    {
      id: 'recordingId',
      title: 'Recording ID',
      type: 'short-input',
      placeholder: 'Enter recording UUID',
      required: true,
      condition: {
        field: 'operation',
        value: ['grain_get_recording', 'grain_get_transcript'],
      },
    },
    // Pagination cursor
    {
      id: 'cursor',
      title: 'Pagination Cursor',
      type: 'short-input',
      placeholder: 'Cursor for next page (optional)',
      condition: {
        field: 'operation',
        value: ['grain_list_recordings'],
      },
    },
    // Before datetime filter
    {
      id: 'beforeDatetime',
      title: 'Before Date',
      type: 'short-input',
      placeholder: 'ISO8601 timestamp (e.g., 2024-01-01T00:00:00Z)',
      condition: {
        field: 'operation',
        value: ['grain_list_recordings'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "yesterday" -> Calculate yesterday's date at 00:00:00Z
- "last week" -> Calculate 7 days ago at 00:00:00Z
- "beginning of this month" -> First day of current month at 00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "yesterday", "last week")...',
        generationType: 'timestamp',
      },
    },
    // After datetime filter
    {
      id: 'afterDatetime',
      title: 'After Date',
      type: 'short-input',
      placeholder: 'ISO8601 timestamp (e.g., 2024-01-01T00:00:00Z)',
      condition: {
        field: 'operation',
        value: ['grain_list_recordings'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "today" -> Today's date at 00:00:00Z
- "last Monday" -> Calculate last Monday's date at 00:00:00Z
- "beginning of last month" -> First day of previous month at 00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "today", "last Monday")...',
        generationType: 'timestamp',
      },
    },
    // Participant scope filter
    {
      id: 'participantScope',
      title: 'Participant Scope',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Internal', id: 'internal' },
        { label: 'External', id: 'external' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: ['grain_list_recordings'],
      },
    },
    // Title search
    {
      id: 'titleSearch',
      title: 'Title Search',
      type: 'short-input',
      placeholder: 'Search by recording title',
      condition: {
        field: 'operation',
        value: ['grain_list_recordings'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a search term for finding recordings by title based on the user's description.
The search term should be:
- Keywords or phrases that would appear in recording titles
- Concise and targeted

Examples:
- "meetings with john" -> John
- "weekly standup" -> standup
- "product demo" -> demo product

Return ONLY the search term - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the recordings you want to find...',
      },
    },
    // Team ID filter
    {
      id: 'teamId',
      title: 'Team ID',
      type: 'short-input',
      placeholder: 'Filter by team UUID (optional)',
      condition: {
        field: 'operation',
        value: ['grain_list_recordings'],
      },
    },
    // Meeting type ID filter
    {
      id: 'meetingTypeId',
      title: 'Meeting Type ID',
      type: 'short-input',
      placeholder: 'Filter by meeting type UUID (optional)',
      condition: {
        field: 'operation',
        value: ['grain_list_recordings'],
      },
    },
    // Include highlights
    {
      id: 'includeHighlights',
      title: 'Include Highlights',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['grain_list_recordings', 'grain_get_recording'],
      },
    },
    // Include participants
    {
      id: 'includeParticipants',
      title: 'Include Participants',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['grain_list_recordings', 'grain_get_recording'],
      },
    },
    // Include AI summary
    {
      id: 'includeAiSummary',
      title: 'Include AI Summary',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['grain_list_recordings', 'grain_get_recording'],
      },
    },
    // Include AI action items
    {
      id: 'includeAiActionItems',
      title: 'Include AI Action Items',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['grain_list_recordings', 'grain_get_recording'],
      },
    },
    {
      id: 'viewId',
      title: 'View ID',
      type: 'short-input',
      placeholder: 'Enter Grain view UUID',
      required: true,
      condition: {
        field: 'operation',
        value: ['grain_create_hook'],
      },
    },
    // Include calendar event (get_recording only)
    {
      id: 'includeCalendarEvent',
      title: 'Include Calendar Event',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['grain_get_recording'],
      },
    },
    // Include HubSpot (get_recording only)
    {
      id: 'includeHubspot',
      title: 'Include HubSpot Data',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['grain_get_recording'],
      },
    },
    // Webhook URL (for create_hook)
    {
      id: 'hookUrl',
      title: 'Webhook URL',
      type: 'short-input',
      placeholder: 'Enter webhook endpoint URL',
      required: true,
      condition: {
        field: 'operation',
        value: ['grain_create_hook'],
      },
    },
    // Hook ID (for delete_hook)
    {
      id: 'hookId',
      title: 'Webhook ID',
      type: 'short-input',
      placeholder: 'Enter webhook UUID to delete',
      required: true,
      condition: {
        field: 'operation',
        value: ['grain_delete_hook'],
      },
    },
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: grainTriggerOptions,
      value: () => 'grain_item_added',
      required: true,
    },
    ...getTrigger('grain_item_added').subBlocks,
    ...getTrigger('grain_item_updated').subBlocks,
    ...getTrigger('grain_webhook').subBlocks,
    ...getTrigger('grain_recording_created').subBlocks,
    ...getTrigger('grain_recording_updated').subBlocks,
    ...getTrigger('grain_highlight_created').subBlocks,
    ...getTrigger('grain_highlight_updated').subBlocks,
    ...getTrigger('grain_story_created').subBlocks,
  ],
  tools: {
    access: [
      'grain_list_recordings',
      'grain_get_recording',
      'grain_get_transcript',
      'grain_list_views',
      'grain_list_teams',
      'grain_list_meeting_types',
      'grain_create_hook',
      'grain_list_hooks',
      'grain_delete_hook',
    ],
    config: {
      tool: (params) => {
        return params.operation || 'grain_list_recordings'
      },
      params: (params) => {
        const baseParams: Record<string, unknown> = {
          apiKey: params.apiKey,
        }

        switch (params.operation) {
          case 'grain_list_recordings':
            return {
              ...baseParams,
              cursor: params.cursor || undefined,
              beforeDatetime: params.beforeDatetime || undefined,
              afterDatetime: params.afterDatetime || undefined,
              participantScope: params.participantScope || undefined,
              titleSearch: params.titleSearch || undefined,
              teamId: params.teamId || undefined,
              meetingTypeId: params.meetingTypeId || undefined,
              includeHighlights: params.includeHighlights || false,
              includeParticipants: params.includeParticipants || false,
              includeAiSummary: params.includeAiSummary || false,
              includeAiActionItems: params.includeAiActionItems || false,
            }

          case 'grain_get_recording':
            if (!params.recordingId?.trim()) {
              throw new Error('Recording ID is required.')
            }
            return {
              ...baseParams,
              recordingId: params.recordingId.trim(),
              includeHighlights: params.includeHighlights || false,
              includeParticipants: params.includeParticipants || false,
              includeAiSummary: params.includeAiSummary || false,
              includeAiActionItems: params.includeAiActionItems || false,
              includeCalendarEvent: params.includeCalendarEvent || false,
              includeHubspot: params.includeHubspot || false,
            }

          case 'grain_get_transcript':
            if (!params.recordingId?.trim()) {
              throw new Error('Recording ID is required.')
            }
            return {
              ...baseParams,
              recordingId: params.recordingId.trim(),
            }

          case 'grain_list_teams':
          case 'grain_list_meeting_types':
          case 'grain_list_views':
          case 'grain_list_hooks':
            return baseParams

          case 'grain_create_hook':
            if (!params.hookUrl?.trim()) {
              throw new Error('Webhook URL is required.')
            }
            if (!params.viewId?.trim()) {
              throw new Error('View ID is required.')
            }
            return {
              ...baseParams,
              hookUrl: params.hookUrl.trim(),
              viewId: params.viewId.trim(),
            }

          case 'grain_delete_hook':
            if (!params.hookId?.trim()) {
              throw new Error('Webhook ID is required.')
            }
            return {
              ...baseParams,
              hookId: params.hookId.trim(),
            }

          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Grain API key (Personal Access Token)' },
    recordingId: { type: 'string', description: 'Recording UUID' },
    cursor: { type: 'string', description: 'Pagination cursor' },
    viewId: { type: 'string', description: 'Grain view UUID for webhook subscriptions' },
    beforeDatetime: {
      type: 'string',
      description: 'Filter recordings before this ISO8601 timestamp',
    },
    afterDatetime: {
      type: 'string',
      description: 'Filter recordings after this ISO8601 timestamp',
    },
    participantScope: {
      type: 'string',
      description: 'Filter by participant scope (internal/external)',
    },
    titleSearch: { type: 'string', description: 'Search recordings by title' },
    teamId: { type: 'string', description: 'Filter by team UUID' },
    meetingTypeId: { type: 'string', description: 'Filter by meeting type UUID' },
    includeHighlights: { type: 'boolean', description: 'Include highlights/clips in response' },
    includeParticipants: { type: 'boolean', description: 'Include participant list in response' },
    includeAiSummary: { type: 'boolean', description: 'Include AI-generated summary' },
    includeAiActionItems: { type: 'boolean', description: 'Include AI-detected action items' },
    includeCalendarEvent: { type: 'boolean', description: 'Include calendar event data' },
    includeHubspot: { type: 'boolean', description: 'Include HubSpot associations' },
    hookUrl: { type: 'string', description: 'Webhook endpoint URL' },
    hookId: { type: 'string', description: 'Webhook UUID to delete' },
  },
  outputs: {
    // Recording outputs
    recordings: { type: 'json', description: 'Array of recording objects' },
    recording: { type: 'json', description: 'Single recording data' },
    id: { type: 'string', description: 'Recording UUID' },
    title: { type: 'string', description: 'Recording title' },
    startDatetime: { type: 'string', description: 'Recording start timestamp' },
    endDatetime: { type: 'string', description: 'Recording end timestamp' },
    durationMs: { type: 'number', description: 'Duration in milliseconds' },
    mediaType: { type: 'string', description: 'Media type (audio/transcript/video)' },
    source: { type: 'string', description: 'Recording source (zoom/meet/teams/etc)' },
    url: { type: 'string', description: 'URL to view in Grain' },
    thumbnailUrl: { type: 'string', description: 'Thumbnail image URL' },
    tags: { type: 'json', description: 'Array of tag strings' },
    teams: { type: 'json', description: 'Teams the recording belongs to' },
    meetingType: { type: 'json', description: 'Meeting type info' },
    highlights: { type: 'json', description: 'Highlights/clips (if included)' },
    participants: { type: 'json', description: 'Participants (if included)' },
    aiSummary: { type: 'json', description: 'AI summary (if included)' },
    calendarEvent: { type: 'json', description: 'Calendar event data (if included)' },
    // Transcript outputs
    transcript: { type: 'json', description: 'Array of transcript sections' },
    // Team outputs
    teamsList: { type: 'json', description: 'Array of team objects' },
    // Meeting type outputs
    meetingTypes: { type: 'json', description: 'Array of meeting type objects' },
    views: { type: 'json', description: 'Array of Grain views' },
    // Hook outputs
    hooks: { type: 'json', description: 'Array of webhook objects' },
    hook: { type: 'json', description: 'Created webhook data' },
    // Pagination
    nextCursor: { type: 'string', description: 'Cursor for next page' },
    hasMore: { type: 'boolean', description: 'Whether more results exist' },
    // Success indicator
    success: { type: 'boolean', description: 'Operation success status' },
    // Trigger outputs
    event: { type: 'string', description: 'Webhook event type' },
    highlight: { type: 'json', description: 'Highlight data from webhook' },
    story: { type: 'json', description: 'Story data from webhook' },
    payload: { type: 'json', description: 'Raw webhook payload' },
    headers: { type: 'json', description: 'Webhook request headers' },
    timestamp: { type: 'string', description: 'Webhook received timestamp' },
  },
  triggers: {
    enabled: true,
    available: [
      'grain_item_added',
      'grain_item_updated',
      'grain_webhook',
      'grain_recording_created',
      'grain_recording_updated',
      'grain_highlight_created',
      'grain_highlight_updated',
      'grain_story_created',
    ],
  },
}

/**
 * grain_v2 — the go-forward Grain block on the v2 Public API (v1 sunsets
 * 2026-09-07). Data operations are identical to v1 (already on v2 endpoints);
 * the webhook operations move to the v2 hooks API (hook_type-scoped, no
 * views), and the trigger set is replaced by the event-type-based
 * `grain_events` trigger.
 */
export const GrainV2Block: BlockConfig = {
  ...GrainBlock,
  type: 'grain_v2',
  hideFromToolbar: false,
  subBlocks: [
    ...GrainBlock.subBlocks.flatMap((sb) => {
      // Drop v1 trigger subblocks (matched per source trigger), the v1
      // trigger picker, and the v1-only view-based fields/operations.
      if (
        sb.mode === 'trigger' ||
        sb.id === 'selectedTriggerId' ||
        sb.id === 'viewId' ||
        sb.id === 'hookUrl' ||
        sb.id === 'hookId'
      ) {
        return []
      }
      if (sb.id === 'operation') {
        return [
          {
            ...sb,
            options: [
              { label: 'List Recordings', id: 'grain_list_recordings' },
              { label: 'Get Recording', id: 'grain_get_recording' },
              { label: 'Get Transcript', id: 'grain_get_transcript' },
              { label: 'List Teams', id: 'grain_list_teams' },
              { label: 'List Meeting Types', id: 'grain_list_meeting_types' },
              { label: 'Create Webhook', id: 'grain_create_hook_v2' },
              { label: 'List Webhooks', id: 'grain_list_hooks_v2' },
              { label: 'Delete Webhook', id: 'grain_delete_hook_v2' },
            ],
          },
        ]
      }
      // Pagination token: rarely hand-entered, belongs under Advanced.
      if (sb.id === 'cursor') {
        return [{ ...sb, mode: 'advanced' as const }]
      }
      return [sb]
    }),
    {
      id: 'hookUrl',
      title: 'Webhook URL',
      type: 'short-input',
      placeholder: 'Enter webhook endpoint URL',
      required: true,
      condition: {
        field: 'operation',
        value: ['grain_create_hook_v2'],
      },
    },
    {
      id: 'hookType',
      title: 'Event Type',
      type: 'dropdown',
      options: GRAIN_HOOK_TYPE_OPTIONS,
      value: () => 'recording_added',
      required: true,
      condition: {
        field: 'operation',
        value: ['grain_create_hook_v2'],
      },
    },
    {
      id: 'hookInclude',
      title: 'Include Options',
      type: 'code',
      language: 'json',
      placeholder:
        '{"participants": true, "highlights": true, "ai_summary": true} (recording hooks) or {"transcript": true, "speakers": true} (highlight hooks)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['grain_create_hook_v2'],
      },
    },
    {
      id: 'hookTypeFilter',
      title: 'Event Type Filter',
      type: 'dropdown',
      options: [{ label: 'All', id: '' }, ...GRAIN_HOOK_TYPE_OPTIONS],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['grain_list_hooks_v2'],
      },
    },
    {
      id: 'hookState',
      title: 'State Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Enabled', id: 'enabled' },
        { label: 'Disabled', id: 'disabled' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['grain_list_hooks_v2'],
      },
    },
    {
      id: 'hookId',
      title: 'Webhook ID',
      type: 'short-input',
      placeholder: 'Enter webhook UUID to delete',
      required: true,
      condition: {
        field: 'operation',
        value: ['grain_delete_hook_v2'],
      },
    },
    ...GRAIN_V2_TRIGGER_IDS.flatMap((triggerId) => getTrigger(triggerId).subBlocks),
  ],
  tools: {
    access: [
      'grain_list_recordings',
      'grain_get_recording',
      'grain_get_transcript',
      'grain_list_teams',
      'grain_list_meeting_types',
      'grain_create_hook_v2',
      'grain_list_hooks_v2',
      'grain_delete_hook_v2',
    ],
    config: {
      tool: (params) => {
        return params.operation || 'grain_list_recordings'
      },
      params: (params) => {
        const baseParams: Record<string, unknown> = {
          apiKey: params.apiKey,
        }

        switch (params.operation) {
          case 'grain_create_hook_v2': {
            if (!params.hookUrl?.trim()) {
              throw new Error('Webhook URL is required.')
            }
            if (!params.hookType?.trim()) {
              throw new Error('Event type is required.')
            }
            let include: unknown
            if (params.hookInclude) {
              try {
                include =
                  typeof params.hookInclude === 'string'
                    ? JSON.parse(params.hookInclude)
                    : params.hookInclude
              } catch {
                throw new Error('Invalid JSON for include options')
              }
            }
            return {
              ...baseParams,
              hookUrl: params.hookUrl.trim(),
              hookType: params.hookType.trim(),
              include,
            }
          }

          case 'grain_list_hooks_v2':
            return {
              ...baseParams,
              hookType: params.hookTypeFilter || undefined,
              state: params.hookState || undefined,
            }

          case 'grain_delete_hook_v2':
            if (!params.hookId?.trim()) {
              throw new Error('Webhook ID is required.')
            }
            return {
              ...baseParams,
              hookId: params.hookId.trim(),
            }

          default:
            return GrainBlock.tools!.config!.params!(params)
        }
      },
    },
  },
  inputs: {
    ...Object.fromEntries(Object.entries(GrainBlock.inputs).filter(([key]) => key !== 'viewId')),
    apiKey: { type: 'string', description: 'Grain API key (Personal or Workspace Access Token)' },
    hookType: { type: 'string', description: 'Grain event type for the webhook' },
    hookInclude: {
      type: 'json',
      description: 'Optional include object controlling webhook payload richness',
    },
    hookTypeFilter: { type: 'string', description: 'Filter listed webhooks by event type' },
    hookState: { type: 'string', description: 'Filter listed webhooks by enabled/disabled state' },
  },
  outputs: {
    // Recording outputs (list + get; get returns the fields at top level)
    recordings: { type: 'json', description: 'Array of recording objects' },
    cursor: { type: 'string', description: 'Cursor for the next page (null when done)' },
    id: { type: 'string', description: 'Recording or webhook UUID' },
    title: { type: 'string', description: 'Recording title' },
    start_datetime: { type: 'string', description: 'Recording start timestamp (ISO8601)' },
    end_datetime: { type: 'string', description: 'Recording end timestamp (ISO8601)' },
    duration_ms: { type: 'number', description: 'Duration in milliseconds' },
    media_type: { type: 'string', description: 'Media type (audio/transcript/video)' },
    source: { type: 'string', description: 'Recording source (zoom/meet/teams/etc)' },
    url: { type: 'string', description: 'URL to view in Grain' },
    thumbnail_url: { type: 'string', description: 'Thumbnail image URL' },
    tags: { type: 'json', description: 'Array of tag strings' },
    teams: { type: 'json', description: 'Teams ([{id, name}])' },
    meeting_type: { type: 'json', description: 'Meeting type info (id, name, scope)' },
    highlights: { type: 'json', description: 'Highlights/clips (if included)' },
    participants: { type: 'json', description: 'Participants (if included)' },
    ai_summary: { type: 'json', description: 'AI summary (if included)' },
    ai_action_items: { type: 'json', description: 'AI action items (if included)' },
    calendar_event: { type: 'json', description: 'Calendar event data (if included)' },
    hubspot: { type: 'json', description: 'HubSpot associations (if included)' },
    // Transcript outputs
    transcript: { type: 'json', description: 'Array of transcript sections' },
    // List outputs
    meeting_types: { type: 'json', description: 'Array of meeting type objects' },
    hooks: { type: 'json', description: 'Array of webhook objects' },
    // Webhook outputs (create returns the hook fields at top level)
    enabled: { type: 'boolean', description: 'Whether the created webhook is active' },
    hook_url: { type: 'string', description: 'Webhook endpoint URL' },
    hook_type: { type: 'string', description: 'Event type the webhook subscribes to' },
    include: { type: 'json', description: 'Include object the webhook was created with' },
    inserted_at: { type: 'string', description: 'Webhook creation timestamp (ISO8601)' },
    success: { type: 'boolean', description: 'Operation success status' },
    // Trigger outputs (v2 event payload envelope)
    type: { type: 'string', description: 'Webhook event type (e.g., recording_added)' },
    user_id: { type: 'string', description: 'User UUID who triggered the event' },
    data: { type: 'json', description: 'Event data (recording, highlight, or story object)' },
  },
  triggers: {
    enabled: true,
    available: [...GRAIN_V2_TRIGGER_IDS],
  },
}

export const GrainBlockMeta = {
  tags: ['meeting', 'note-taking'],
  url: 'https://grain.com',
  templates: [
    {
      icon: GrainIcon,
      title: 'Grain highlight to CRM',
      prompt:
        'Build a workflow that watches Grain meeting highlights, extracts customer quotes, and writes them to the linked Salesforce opportunity for deal context.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: GrainIcon,
      title: 'Grain customer-quote miner',
      prompt:
        'Create a workflow that processes Grain customer interview recordings, extracts notable quotes and themes, and writes them to a marketing research table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: GrainIcon,
      title: 'Grain action-item ticket creator',
      prompt:
        'Build a workflow that extracts action items from Grain meeting transcripts, creates Linear tasks for each with owners and due dates, and pings the team in Slack.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'automation'],
      alsoIntegrations: ['linear', 'slack'],
    },
    {
      icon: GrainIcon,
      title: 'Grain weekly call digest',
      prompt:
        'Create a scheduled weekly workflow that summarizes Grain meeting insights — common objections, decisions made, blockers — and posts a digest to the team Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GrainIcon,
      title: 'Grain coaching dashboard',
      prompt:
        'Build a scheduled weekly workflow that analyzes Grain sales calls per rep, calculates talk ratio, objection handling, and next-step clarity, and writes coaching notes to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'analysis'],
    },
    {
      icon: GrainIcon,
      title: 'Grain + Notion knowledge sync',
      prompt:
        'Create a workflow that processes Grain meeting recordings, extracts decisions and learnings, and writes them as Notion pages tagged by topic for the team knowledge base.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'content'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: GrainIcon,
      title: 'Grain competitor mentions tracker',
      prompt:
        'Build a scheduled workflow that scans Grain sales transcripts for competitor mentions, logs the context and outcome to a competitive-intel table, and posts a weekly pattern summary to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'summarize-recent-calls',
      description:
        'Pull recent Grain recordings and produce a digest of key takeaways and action items per call.',
      content:
        '# Summarize Recent Calls\n\nTurn recent meeting recordings into a readable digest.\n\n## Steps\n1. List recordings, optionally filtered by a before/after datetime window, and paginate with the cursor if needed.\n2. For each recording, get the recording details and the transcript.\n3. From each transcript, extract the main topic, key takeaways, decisions, and action items with owners.\n4. Keep the per-call summary concise and consistent in structure.\n\n## Output\nReturn a digest with one section per call: title, date, participants, takeaways, and action items. Suitable for a daily or weekly recap.',
    },
    {
      name: 'extract-deal-signals',
      description:
        'Scan Grain sales-call transcripts for buying signals, objections, and competitor mentions.',
      content:
        '# Extract Deal Signals\n\nMine sales transcripts for signals that move a deal forward.\n\n## Steps\n1. List recordings for the target time window, filtering by meeting type or team to isolate sales calls (use List Meeting Types / List Teams to find the IDs).\n2. Get the transcript for each recording.\n3. Classify mentions into buying signals, objections/risks, competitor mentions, and next steps, capturing the verbatim quote and context.\n4. Apply a framework (e.g. MEDDIC or SPICED) if one is specified to tag each insight.\n\n## Output\nReturn a structured list of signals grouped by category, each with the quote, the call it came from, and a suggested follow-up. Useful for CRM notes or a deal review.',
    },
    {
      name: 'pull-transcript',
      description: 'Retrieve a specific Grain recording and its full transcript by ID.',
      content:
        '# Pull Transcript\n\nFetch a single recording and its transcript for downstream use.\n\n## Steps\n1. If only a title or date is known, list recordings and match to find the recording ID.\n2. Get the recording details for metadata (title, participants, duration, date).\n3. Get the transcript for the recording.\n4. Clean the transcript into readable speaker-labeled turns.\n\n## Output\nReturn the recording metadata plus the formatted transcript. This is the building block for summaries, follow-up emails, or knowledge base ingestion.',
    },
    {
      name: 'audit-grain-webhooks',
      description:
        'List, create, and prune Grain webhook subscriptions so external systems only receive the events they need.',
      content:
        '# Audit Grain Webhooks\n\nKeep webhook subscriptions tidy and pointed at live endpoints.\n\n## Steps\n1. List webhooks, optionally filtered by event type or enabled/disabled state.\n2. Compare against the endpoints and event types that should exist; flag disabled hooks and hooks pointing at dead URLs.\n3. Delete stale or duplicate webhooks by ID.\n4. Create any missing webhooks with the right event type (note: the endpoint must respond 2xx to a reachability test on creation).\n\n## Output\nReturn a reconciliation summary: hooks kept, hooks deleted, hooks created, each with event type and URL.',
    },
    {
      name: 'segment-calls-by-team',
      description:
        'Break down Grain call volume and content by team or meeting type for reporting.',
      content:
        '# Segment Calls By Team\n\nProduce a per-team or per-meeting-type view of call activity.\n\n## Steps\n1. List teams and meeting types to get their IDs.\n2. For each segment, list recordings filtered by that team or meeting type over the reporting window, paginating with the cursor.\n3. Aggregate counts, total duration, and notable calls per segment.\n\n## Output\nReturn a table-style summary per segment: call count, total hours, and links to representative recordings. Useful for weekly ops or enablement reporting.',
    },
  ],
} as const satisfies BlockMeta

export const GrainV2BlockMeta = GrainBlockMeta
