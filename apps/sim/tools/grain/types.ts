/**
 * Grain API Types
 * Base URL: https://api.grain.com/_/public-api
 * API Version: 2025-10-31
 */

import type { ToolResponse } from '@/tools/types'
export interface GrainTeam {
  id: string
  name: string
}

export interface GrainMeetingType {
  id: string
  name: string
  scope: 'internal' | 'external'
}

export interface GrainParticipant {
  id: string
  name: string
  email: string | null
  scope: 'internal' | 'external' | 'unknown'
  confirmed_attendee: boolean
  hs_contact_id?: string | null
}

export interface GrainHighlight {
  id: string
  recording_id: string
  text: string
  transcript: string
  speakers: string[]
  timestamp: number
  duration: number
  tags: string[]
  url: string
  thumbnail_url: string
  created_datetime: string
}

export interface GrainAiSummary {
  text: string
}

export interface GrainCalendarEvent {
  ical_uid: string
}

export interface GrainHubspotData {
  hubspot_company_ids: string[]
  hubspot_deal_ids: string[]
}

export interface GrainAiTemplateSection {
  title: string
  data: Record<string, unknown>
}

export interface GrainPrivateNotes {
  text: string
}

export interface GrainTranscriptSection {
  participant_id: string | null
  speaker: string
  start: number
  end: number
  text: string
}

export interface GrainRecording {
  id: string
  title: string
  start_datetime: string
  end_datetime: string
  duration_ms: number
  media_type: 'audio' | 'transcript' | 'video'
  source: 'aircall' | 'local_capture' | 'meet' | 'teams' | 'upload' | 'webex' | 'zoom' | 'other'
  url: string
  thumbnail_url: string | null
  tags: string[]
  teams: GrainTeam[]
  meeting_type: GrainMeetingType | null
  highlights?: GrainHighlight[]
  participants?: GrainParticipant[]
  ai_summary?: GrainAiSummary
  calendar_event?: GrainCalendarEvent | null
  hubspot?: GrainHubspotData
  private_notes?: GrainPrivateNotes | null
  ai_template_sections?: GrainAiTemplateSection[]
}

export interface GrainHook {
  id: string
  enabled: boolean
  version?: number
  hook_url: string
  view_id?: string
  actions?: Array<'added' | 'updated' | 'removed'>
  inserted_at: string
}

export interface GrainView {
  id: string
  name?: string
  type?: 'recordings' | 'highlights' | 'stories'
}

export interface GrainListViewsParams {
  apiKey: string
  typeFilter?: 'recordings' | 'highlights' | 'stories'
}

export interface GrainListViewsResponse extends ToolResponse {
  output: {
    views: GrainView[]
  }
}

export interface GrainListRecordingsParams {
  apiKey: string
  cursor?: string
  beforeDatetime?: string
  afterDatetime?: string
  participantScope?: 'internal' | 'external'
  titleSearch?: string
  teamId?: string
  meetingTypeId?: string
  includeHighlights?: boolean
  includeParticipants?: boolean
  includeAiSummary?: boolean
}

export interface GrainListRecordingsResponse extends ToolResponse {
  output: {
    recordings: GrainRecording[]
    cursor: string | null
  }
}

export interface GrainGetRecordingParams {
  apiKey: string
  recordingId: string
  includeHighlights?: boolean
  includeParticipants?: boolean
  includeAiSummary?: boolean
  includeCalendarEvent?: boolean
  includeHubspot?: boolean
}

export interface GrainGetRecordingResponse extends ToolResponse {
  output: GrainRecording
}

export interface GrainGetTranscriptParams {
  apiKey: string
  recordingId: string
}

export interface GrainGetTranscriptResponse extends ToolResponse {
  output: {
    transcript: GrainTranscriptSection[]
  }
}

export interface GrainListTeamsParams {
  apiKey: string
}

export interface GrainListTeamsResponse extends ToolResponse {
  output: {
    teams: GrainTeam[]
  }
}

export interface GrainListMeetingTypesParams {
  apiKey: string
}

export interface GrainListMeetingTypesResponse extends ToolResponse {
  output: {
    meeting_types: GrainMeetingType[]
  }
}

export interface GrainCreateHookParams {
  apiKey: string
  hookUrl: string
  viewId: string
  actions?: Array<'added' | 'updated' | 'removed'>
}

export interface GrainCreateHookResponse extends ToolResponse {
  output: GrainHook
}

export interface GrainListHooksParams {
  apiKey: string
}

export interface GrainListHooksResponse extends ToolResponse {
  output: {
    hooks: GrainHook[]
  }
}

export interface GrainDeleteHookParams {
  apiKey: string
  hookId: string
}

export interface GrainDeleteHookResponse extends ToolResponse {
  output: {
    success: true
  }
}
