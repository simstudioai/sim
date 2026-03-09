import { GrainIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { getTrigger } from '@/triggers'
import { grainTriggerOptions } from '@/triggers/grain/utils'

export const GrainBlock: BlockConfig = {
  type: 'grain',
  name: 'Grain',
  description: 'Access meeting recordings, transcripts, and AI summaries',
  authMode: AuthMode.ApiKey,
  triggerAllowed: true,
  longDescription:
    'Integrate Grain into your workflow. Access meeting recordings, transcripts, highlights, and AI-generated summaries. Can also trigger workflows based on Grain webhook events.',
  category: 'tools',
  docsLink: 'https://docs.sim.ai/tools/grain',
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
        value: ['grain_list_recordings', 'grain_create_hook'],
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
        value: ['grain_list_recordings', 'grain_create_hook'],
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
        value: ['grain_list_recordings', 'grain_create_hook'],
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
        value: ['grain_list_recordings', 'grain_create_hook'],
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
        value: ['grain_list_recordings', 'grain_create_hook'],
      },
    },
    // Include highlights
    {
      id: 'includeHighlights',
      title: 'Include Highlights',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['grain_list_recordings', 'grain_get_recording', 'grain_create_hook'],
      },
    },
    // Include participants
    {
      id: 'includeParticipants',
      title: 'Include Participants',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['grain_list_recordings', 'grain_get_recording', 'grain_create_hook'],
      },
    },
    // Include AI summary
    {
      id: 'includeAiSummary',
      title: 'Include AI Summary',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['grain_list_recordings', 'grain_get_recording', 'grain_create_hook'],
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
      value: () => 'grain_webhook',
      required: true,
    },
    ...getTrigger('grain_recording_created').subBlocks,
    ...getTrigger('grain_recording_updated').subBlocks,
    ...getTrigger('grain_highlight_created').subBlocks,
    ...getTrigger('grain_highlight_updated').subBlocks,
    ...getTrigger('grain_story_created').subBlocks,
    ...getTrigger('grain_webhook').subBlocks,
  ],
  tools: {
    access: [
      'grain_list_recordings',
      'grain_get_recording',
      'grain_get_transcript',
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
          case 'grain_list_hooks':
            return baseParams

          case 'grain_create_hook':
            if (!params.hookUrl?.trim()) {
              throw new Error('Webhook URL is required.')
            }
            return {
              ...baseParams,
              hookUrl: params.hookUrl.trim(),
              filterBeforeDatetime: params.beforeDatetime || undefined,
              filterAfterDatetime: params.afterDatetime || undefined,
              filterParticipantScope: params.participantScope || undefined,
              filterTeamId: params.teamId || undefined,
              filterMeetingTypeId: params.meetingTypeId || undefined,
              includeHighlights: params.includeHighlights || false,
              includeParticipants: params.includeParticipants || false,
              includeAiSummary: params.includeAiSummary || false,
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
      'grain_recording_created',
      'grain_recording_updated',
      'grain_highlight_created',
      'grain_highlight_updated',
      'grain_story_created',
      'grain_webhook',
    ],
  },
}
