import type { FathomListMeetingsParams, FathomListMeetingsResponse } from '@/tools/fathom/types'
import type { ToolConfig } from '@/tools/types'

export const listMeetingsTool: ToolConfig<FathomListMeetingsParams, FathomListMeetingsResponse> = {
  id: 'fathom_list_meetings',
  name: 'Fathom List Meetings',
  description: 'List recent meetings recorded by the user or shared to their team.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Fathom API Key',
    },
    includeSummary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include meeting summary (true/false)',
    },
    includeTranscript: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include meeting transcript (true/false)',
    },
    includeActionItems: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include action items (true/false)',
    },
    includeCrmMatches: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include linked CRM matches (true/false)',
    },
    includeHighlights: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include meeting highlights (true/false)',
    },
    createdAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter meetings created after this ISO 8601 timestamp',
    },
    createdBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter meetings created before this ISO 8601 timestamp',
    },
    recordedBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by recorder email address',
    },
    teams: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by team name',
    },
    meetingType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by meeting type name',
    },
    calendarInviteesDomains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by calendar invitee company domain (exact match)',
    },
    calendarInviteesDomainsType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by invitee domain type: all, only_internal, or one_or_more_external',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.fathom.ai/external/v1/meetings')
      if (params.includeSummary === 'true') url.searchParams.append('include_summary', 'true')
      if (params.includeTranscript === 'true') url.searchParams.append('include_transcript', 'true')
      if (params.includeActionItems === 'true')
        url.searchParams.append('include_action_items', 'true')
      if (params.includeCrmMatches === 'true')
        url.searchParams.append('include_crm_matches', 'true')
      if (params.includeHighlights === 'true') url.searchParams.append('include_highlights', 'true')
      if (params.createdAfter) url.searchParams.append('created_after', params.createdAfter)
      if (params.createdBefore) url.searchParams.append('created_before', params.createdBefore)
      if (params.recordedBy) url.searchParams.append('recorded_by[]', params.recordedBy)
      if (params.teams) url.searchParams.append('teams[]', params.teams)
      if (params.meetingType) url.searchParams.append('meeting_type', params.meetingType)
      if (params.calendarInviteesDomains)
        url.searchParams.append('calendar_invitees_domains[]', params.calendarInviteesDomains)
      if (params.calendarInviteesDomainsType && params.calendarInviteesDomainsType !== 'all')
        url.searchParams.append(
          'calendar_invitees_domains_type',
          params.calendarInviteesDomainsType
        )
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as Record<string, string>).message ||
          `Fathom API error: ${response.status} ${response.statusText}`,
        output: {
          meetings: [],
          next_cursor: null,
        },
      }
    }

    const data = await response.json()

    const meetings = (data.items ?? []).map(
      (meeting: Record<string, unknown> & { recorded_by?: Record<string, unknown> }) => ({
        title: meeting.title ?? '',
        meeting_title: meeting.meeting_title ?? null,
        meeting_type: meeting.meeting_type ?? null,
        recording_id: meeting.recording_id ?? null,
        url: meeting.url ?? '',
        meeting_url: meeting.meeting_url ?? null,
        share_url: meeting.share_url ?? '',
        created_at: meeting.created_at ?? '',
        scheduled_start_time: meeting.scheduled_start_time ?? null,
        scheduled_end_time: meeting.scheduled_end_time ?? null,
        recording_start_time: meeting.recording_start_time ?? null,
        recording_end_time: meeting.recording_end_time ?? null,
        transcript_language: meeting.transcript_language ?? '',
        calendar_invitees_domains_type: meeting.calendar_invitees_domains_type ?? null,
        shared_with: meeting.shared_with ?? null,
        recorded_by: meeting.recorded_by
          ? {
              name: meeting.recorded_by.name ?? '',
              email: meeting.recorded_by.email ?? '',
              email_domain: meeting.recorded_by.email_domain ?? '',
              team: meeting.recorded_by.team ?? null,
            }
          : null,
        calendar_invitees: (meeting.calendar_invitees as Array<Record<string, unknown>>) ?? [],
        default_summary: meeting.default_summary ?? null,
        transcript: meeting.transcript ?? null,
        action_items: meeting.action_items ?? null,
        highlights: meeting.highlights ?? null,
        crm_matches: meeting.crm_matches ?? null,
      })
    )

    return {
      success: true,
      output: {
        meetings,
        next_cursor: data.next_cursor ?? null,
      },
    }
  },

  outputs: {
    meetings: {
      type: 'array',
      description: 'List of meetings',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Meeting title' },
          meeting_type: { type: 'string', description: 'Meeting type name', optional: true },
          recording_id: { type: 'number', description: 'Unique recording ID' },
          url: { type: 'string', description: 'URL to view the meeting' },
          meeting_url: {
            type: 'string',
            description: 'URL of the underlying video call (Zoom, Meet, Teams, etc.)',
            optional: true,
          },
          share_url: { type: 'string', description: 'Shareable URL' },
          created_at: { type: 'string', description: 'Creation timestamp' },
          transcript_language: { type: 'string', description: 'Transcript language' },
          shared_with: {
            type: 'string',
            description: 'Sharing scope: no_teams, single_team, multiple_teams, or all_teams',
            optional: true,
          },
          highlights: {
            type: 'array',
            description: 'Meeting highlights with type, summary, text, and start/end time',
            optional: true,
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: 'Highlight type' },
                summary: { type: 'string', description: 'Highlight summary', optional: true },
                text: { type: 'string', description: 'Highlight text' },
                start_time: { type: 'number', description: 'Start time in seconds' },
                end_time: { type: 'number', description: 'End time in seconds' },
              },
            },
          },
        },
      },
    },
    next_cursor: {
      type: 'string',
      description: 'Pagination cursor for next page',
      optional: true,
    },
  },
}
