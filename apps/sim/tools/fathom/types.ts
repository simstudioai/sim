import type { ToolResponse } from '@/tools/types'

export interface FathomBaseParams {
  apiKey: string
}

export interface FathomListMeetingsParams extends FathomBaseParams {
  includeSummary?: string
  includeTranscript?: string
  includeActionItems?: string
  includeCrmMatches?: string
  createdAfter?: string
  createdBefore?: string
  recordedBy?: string
  teams?: string
  cursor?: string
}

export interface FathomListMeetingsResponse extends ToolResponse {
  output: {
    meetings: Array<{
      title: string
      meeting_title: string | null
      recording_id: number | null
      url: string
      share_url: string
      created_at: string
      scheduled_start_time: string | null
      scheduled_end_time: string | null
      recording_start_time: string | null
      recording_end_time: string | null
      transcript_language: string
      calendar_invitees_domains_type: string | null
      recorded_by: { name: string; email: string; email_domain: string; team: string | null } | null
      calendar_invitees: Array<{
        name: string | null
        email: string
        email_domain: string | null
        is_external: boolean
        matched_speaker_display_name: string | null
      }>
      default_summary: { template_name: string | null; markdown_formatted: string | null } | null
      transcript: Array<{
        speaker: { display_name: string; matched_calendar_invitee_email: string | null }
        text: string
        timestamp: string
      }> | null
      action_items: Array<{
        description: string
        user_generated: boolean
        completed: boolean
        recording_timestamp: string
        recording_playback_url: string
        assignee: { name: string | null; email: string | null; team: string | null }
      }> | null
      crm_matches: {
        contacts: Array<{ name: string; email: string; record_url: string }>
        companies: Array<{ name: string; record_url: string }>
        deals: Array<{ name: string; amount: number; record_url: string }>
        error: string | null
      } | null
    }>
    next_cursor: string | null
  }
}

export interface FathomGetSummaryParams extends FathomBaseParams {
  recordingId: string
}

export interface FathomGetSummaryResponse extends ToolResponse {
  output: {
    template_name: string | null
    markdown_formatted: string | null
  }
}

export interface FathomGetTranscriptParams extends FathomBaseParams {
  recordingId: string
}

export interface FathomGetTranscriptResponse extends ToolResponse {
  output: {
    transcript: Array<{
      speaker: { display_name: string; matched_calendar_invitee_email: string | null }
      text: string
      timestamp: string
    }>
  }
}

export interface FathomListTeamMembersParams extends FathomBaseParams {
  teams?: string
  cursor?: string
}

export interface FathomListTeamMembersResponse extends ToolResponse {
  output: {
    members: Array<{
      name: string
      email: string
      created_at: string
    }>
    next_cursor: string | null
  }
}

export interface FathomListTeamsParams extends FathomBaseParams {
  cursor?: string
}

export interface FathomListTeamsResponse extends ToolResponse {
  output: {
    teams: Array<{
      name: string
      created_at: string
    }>
    next_cursor: string | null
  }
}

export type FathomResponse =
  | FathomListMeetingsResponse
  | FathomGetSummaryResponse
  | FathomGetTranscriptResponse
  | FathomListTeamMembersResponse
  | FathomListTeamsResponse
