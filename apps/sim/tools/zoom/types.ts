// Common types for Zoom tools
import type { ToolResponse } from '@/tools/types'

// Common parameters for all Zoom tools
export interface ZoomBaseParams {
  accessToken: string
}

// Meeting types
export type ZoomMeetingType = 1 | 2 | 3 | 8 // 1=instant, 2=scheduled, 3=recurring no fixed time, 8=recurring fixed time

export interface ZoomMeetingSettings {
  host_video?: boolean
  participant_video?: boolean
  join_before_host?: boolean
  mute_upon_entry?: boolean
  watermark?: boolean
  audio?: 'both' | 'telephony' | 'voip'
  auto_recording?: 'local' | 'cloud' | 'none'
  waiting_room?: boolean
  meeting_authentication?: boolean
  approval_type?: 0 | 1 | 2 // 0=auto, 1=manual, 2=none
}

export interface ZoomMeeting {
  id: number
  uuid: string
  host_id: string
  host_email?: string
  topic: string
  type: ZoomMeetingType
  status?: string
  start_time?: string
  duration?: number
  timezone?: string
  agenda?: string
  created_at?: string
  start_url?: string
  join_url: string
  password?: string
  h323_password?: string
  pstn_password?: string
  encrypted_password?: string
  settings?: ZoomMeetingSettings
  recurrence?: {
    type: number
    repeat_interval?: number
    weekly_days?: string
    monthly_day?: number
    monthly_week?: number
    monthly_week_day?: number
    end_times?: number
    end_date_time?: string
  }
  occurrences?: Array<{
    occurrence_id: string
    start_time: string
    duration: number
    status: string
  }>
}

export interface ZoomMeetingListResponse {
  page_count: number
  page_number: number
  page_size: number
  total_records: number
  next_page_token?: string
  meetings: ZoomMeeting[]
}

// Create Meeting tool types
export interface ZoomCreateMeetingParams extends ZoomBaseParams {
  userId: string
  topic: string
  type?: ZoomMeetingType
  startTime?: string
  duration?: number
  timezone?: string
  password?: string
  agenda?: string
  hostVideo?: boolean
  participantVideo?: boolean
  joinBeforeHost?: boolean
  muteUponEntry?: boolean
  waitingRoom?: boolean
  autoRecording?: 'local' | 'cloud' | 'none'
}

export interface ZoomCreateMeetingResponse extends ToolResponse {
  output: {
    meeting: ZoomMeeting
  }
}

// List Meetings tool types
export interface ZoomListMeetingsParams extends ZoomBaseParams {
  userId: string
  type?: 'scheduled' | 'live' | 'upcoming' | 'upcoming_meetings' | 'previous_meetings'
  pageSize?: number
  nextPageToken?: string
}

export interface ZoomListMeetingsResponse extends ToolResponse {
  output: {
    meetings: ZoomMeeting[]
    pageInfo: {
      pageCount: number
      pageNumber: number
      pageSize: number
      totalRecords: number
      nextPageToken?: string
    }
  }
}

// Get Meeting tool types
export interface ZoomGetMeetingParams extends ZoomBaseParams {
  meetingId: string
  occurrenceId?: string
  showPreviousOccurrences?: boolean
}

export interface ZoomGetMeetingResponse extends ToolResponse {
  output: {
    meeting: ZoomMeeting
  }
}

// Update Meeting tool types
export interface ZoomUpdateMeetingParams extends ZoomBaseParams {
  meetingId: string
  topic?: string
  type?: ZoomMeetingType
  startTime?: string
  duration?: number
  timezone?: string
  password?: string
  agenda?: string
  hostVideo?: boolean
  participantVideo?: boolean
  joinBeforeHost?: boolean
  muteUponEntry?: boolean
  waitingRoom?: boolean
  autoRecording?: 'local' | 'cloud' | 'none'
}

export interface ZoomUpdateMeetingResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

// Delete Meeting tool types
export interface ZoomDeleteMeetingParams extends ZoomBaseParams {
  meetingId: string
  occurrenceId?: string
  scheduleForReminder?: boolean
  cancelMeetingReminder?: boolean
}

export interface ZoomDeleteMeetingResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

// Get Meeting Invitation tool types
export interface ZoomGetMeetingInvitationParams extends ZoomBaseParams {
  meetingId: string
}

export interface ZoomGetMeetingInvitationResponse extends ToolResponse {
  output: {
    invitation: string
  }
}

// Combined response type for block
export type ZoomResponse =
  | ZoomCreateMeetingResponse
  | ZoomListMeetingsResponse
  | ZoomGetMeetingResponse
  | ZoomUpdateMeetingResponse
  | ZoomDeleteMeetingResponse
  | ZoomGetMeetingInvitationResponse
