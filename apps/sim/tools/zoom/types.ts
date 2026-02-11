// Common types for Zoom tools
import type { OutputProperty, ToolFileData, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Zoom API responses.
 * These are reusable across all Zoom tools to ensure consistency.
 * Based on the official Zoom API documentation.
 */

/**
 * Output definition for meeting settings objects
 * @see https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/meetingCreate
 */
export const MEETING_SETTINGS_OUTPUT_PROPERTIES = {
  host_video: { type: 'boolean', description: 'Start with host video on' },
  participant_video: { type: 'boolean', description: 'Start with participant video on' },
  join_before_host: { type: 'boolean', description: 'Allow participants to join before host' },
  mute_upon_entry: { type: 'boolean', description: 'Mute participants upon entry' },
  watermark: { type: 'boolean', description: 'Add watermark when viewing shared screen' },
  audio: { type: 'string', description: 'Audio options: both, telephony, or voip' },
  auto_recording: { type: 'string', description: 'Auto recording: local, cloud, or none' },
  waiting_room: { type: 'boolean', description: 'Enable waiting room' },
  meeting_authentication: { type: 'boolean', description: 'Require meeting authentication' },
  approval_type: { type: 'number', description: 'Approval type: 0=auto, 1=manual, 2=none' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete meeting settings object output definition
 */
export const MEETING_SETTINGS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Meeting settings',
  properties: MEETING_SETTINGS_OUTPUT_PROPERTIES,
}

/**
 * Output definition for recurrence objects in recurring meetings
 * @see https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/meetingCreate
 */
export const RECURRENCE_OUTPUT_PROPERTIES = {
  type: { type: 'number', description: 'Recurrence type: 1=daily, 2=weekly, 3=monthly' },
  repeat_interval: { type: 'number', description: 'Interval between recurring meetings' },
  weekly_days: {
    type: 'string',
    description: 'Days of week for weekly recurrence (1-7, comma-separated)',
  },
  monthly_day: { type: 'number', description: 'Day of month for monthly recurrence' },
  monthly_week: { type: 'number', description: 'Week of month for monthly recurrence' },
  monthly_week_day: { type: 'number', description: 'Day of week for monthly recurrence' },
  end_times: { type: 'number', description: 'Number of occurrences' },
  end_date_time: { type: 'string', description: 'End date time in ISO 8601 format' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete recurrence object output definition
 */
export const RECURRENCE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Recurrence settings for recurring meetings',
  properties: RECURRENCE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for occurrence objects in recurring meetings
 * @see https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/meeting
 */
export const OCCURRENCE_OUTPUT_PROPERTIES = {
  occurrence_id: { type: 'string', description: 'Occurrence ID' },
  start_time: { type: 'string', description: 'Start time in ISO 8601 format' },
  duration: { type: 'number', description: 'Duration in minutes' },
  status: { type: 'string', description: 'Occurrence status' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete occurrences array output definition
 */
export const OCCURRENCES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Meeting occurrences for recurring meetings',
  items: {
    type: 'object',
    properties: OCCURRENCE_OUTPUT_PROPERTIES,
  },
}

/**
 * Common meeting output properties shared across meeting tools
 * @see https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/meetingCreate
 * @see https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/meeting
 */
export const MEETING_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Meeting ID' },
  uuid: { type: 'string', description: 'Meeting UUID' },
  host_id: { type: 'string', description: 'Host user ID' },
  host_email: { type: 'string', description: 'Host email address' },
  topic: { type: 'string', description: 'Meeting topic' },
  type: {
    type: 'number',
    description:
      'Meeting type: 1=instant, 2=scheduled, 3=recurring no fixed time, 8=recurring fixed time',
  },
  status: { type: 'string', description: 'Meeting status (e.g., waiting, started)' },
  start_time: { type: 'string', description: 'Start time in ISO 8601 format' },
  duration: { type: 'number', description: 'Duration in minutes' },
  timezone: { type: 'string', description: 'Timezone (e.g., America/Los_Angeles)' },
  agenda: { type: 'string', description: 'Meeting agenda' },
  created_at: { type: 'string', description: 'Creation timestamp in ISO 8601 format' },
  start_url: { type: 'string', description: 'URL for host to start the meeting' },
  join_url: { type: 'string', description: 'URL for participants to join the meeting' },
  password: { type: 'string', description: 'Meeting password' },
  h323_password: { type: 'string', description: 'H.323/SIP room system password' },
  pstn_password: { type: 'string', description: 'PSTN password for phone dial-in' },
  encrypted_password: { type: 'string', description: 'Encrypted password for joining' },
  settings: MEETING_SETTINGS_OUTPUT,
  recurrence: RECURRENCE_OUTPUT,
  occurrences: OCCURRENCES_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for meeting object (used in create/get meeting responses)
 */
export const MEETING_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Meeting object with all properties',
  properties: MEETING_OUTPUT_PROPERTIES,
}

/**
 * Meeting list item output properties (subset returned in list responses)
 * @see https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/meetings
 */
export const MEETING_LIST_ITEM_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Meeting ID' },
  uuid: { type: 'string', description: 'Meeting UUID' },
  host_id: { type: 'string', description: 'Host user ID' },
  topic: { type: 'string', description: 'Meeting topic' },
  type: { type: 'number', description: 'Meeting type' },
  start_time: { type: 'string', description: 'Start time in ISO 8601 format' },
  duration: { type: 'number', description: 'Duration in minutes' },
  timezone: { type: 'string', description: 'Timezone' },
  agenda: { type: 'string', description: 'Meeting agenda' },
  created_at: { type: 'string', description: 'Creation timestamp' },
  join_url: { type: 'string', description: 'URL for participants to join' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for meetings array in list responses
 */
export const MEETINGS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of meetings',
  items: {
    type: 'object',
    properties: MEETING_LIST_ITEM_OUTPUT_PROPERTIES,
  },
}

/**
 * Pagination output properties for meeting list endpoints
 * @see https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/meetings
 */
export const MEETING_PAGE_INFO_OUTPUT_PROPERTIES = {
  pageCount: { type: 'number', description: 'Total number of pages' },
  pageNumber: { type: 'number', description: 'Current page number' },
  pageSize: { type: 'number', description: 'Number of records per page' },
  totalRecords: { type: 'number', description: 'Total number of records' },
  nextPageToken: { type: 'string', description: 'Token for next page of results' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete page info output definition for meeting lists
 */
export const MEETING_PAGE_INFO_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pagination information',
  properties: MEETING_PAGE_INFO_OUTPUT_PROPERTIES,
}

/**
 * Output definition for recording file objects
 * @see https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/recordingGet
 */
export const RECORDING_FILE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Recording file ID' },
  meeting_id: { type: 'string', description: 'Meeting ID associated with the recording' },
  recording_start: { type: 'string', description: 'Start time of the recording' },
  recording_end: { type: 'string', description: 'End time of the recording' },
  file_type: { type: 'string', description: 'Type of recording file (MP4, M4A, etc.)' },
  file_extension: { type: 'string', description: 'File extension' },
  file_size: { type: 'number', description: 'File size in bytes' },
  play_url: { type: 'string', description: 'URL to play the recording' },
  download_url: { type: 'string', description: 'URL to download the recording' },
  status: { type: 'string', description: 'Recording status' },
  recording_type: {
    type: 'string',
    description: 'Type of recording (shared_screen, audio_only, etc.)',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete recording files array output definition
 */
export const RECORDING_FILES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of recording files',
  items: {
    type: 'object',
    properties: RECORDING_FILE_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for recording objects
 * @see https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/recordingGet
 * @see https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/recordingsList
 */
export const RECORDING_OUTPUT_PROPERTIES = {
  uuid: { type: 'string', description: 'Meeting UUID' },
  id: { type: 'number', description: 'Meeting ID' },
  account_id: { type: 'string', description: 'Account ID' },
  host_id: { type: 'string', description: 'Host user ID' },
  topic: { type: 'string', description: 'Meeting topic' },
  type: { type: 'number', description: 'Meeting type' },
  start_time: { type: 'string', description: 'Meeting start time' },
  duration: { type: 'number', description: 'Meeting duration in minutes' },
  total_size: { type: 'number', description: 'Total size of all recordings in bytes' },
  recording_count: { type: 'number', description: 'Number of recording files' },
  share_url: { type: 'string', description: 'URL to share recordings' },
  recording_files: RECORDING_FILES_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Complete recording object output definition
 */
export const RECORDING_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Recording object with all files',
  properties: RECORDING_OUTPUT_PROPERTIES,
}

/**
 * Output definition for recordings array in list responses
 */
export const RECORDINGS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of recordings',
  items: {
    type: 'object',
    properties: RECORDING_OUTPUT_PROPERTIES,
  },
}

/**
 * Pagination output properties for recording list endpoints
 * @see https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/recordingsList
 */
export const RECORDING_PAGE_INFO_OUTPUT_PROPERTIES = {
  from: { type: 'string', description: 'Start date of query range' },
  to: { type: 'string', description: 'End date of query range' },
  pageSize: { type: 'number', description: 'Number of records per page' },
  totalRecords: { type: 'number', description: 'Total number of records' },
  nextPageToken: { type: 'string', description: 'Token for next page of results' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete page info output definition for recording lists
 */
export const RECORDING_PAGE_INFO_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pagination information',
  properties: RECORDING_PAGE_INFO_OUTPUT_PROPERTIES,
}

/**
 * Output definition for participant objects
 * @see https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/pastMeetingParticipants
 */
export const PARTICIPANT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Participant unique identifier' },
  user_id: { type: 'string', description: 'User ID if registered Zoom user' },
  name: { type: 'string', description: 'Participant display name' },
  user_email: { type: 'string', description: 'Participant email address' },
  join_time: { type: 'string', description: 'Time when participant joined (ISO 8601)' },
  leave_time: { type: 'string', description: 'Time when participant left (ISO 8601)' },
  duration: { type: 'number', description: 'Duration in seconds participant was in meeting' },
  attentiveness_score: { type: 'string', description: 'Attentiveness score (deprecated)' },
  failover: {
    type: 'boolean',
    description: 'Whether participant failed over to another data center',
  },
  status: { type: 'string', description: 'Participant status' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete participants array output definition
 */
export const PARTICIPANTS_ARRAY_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of meeting participants',
  items: {
    type: 'object',
    properties: PARTICIPANT_OUTPUT_PROPERTIES,
  },
}

/**
 * Pagination output properties for participant list endpoints
 * @see https://developers.zoom.us/docs/api/rest/reference/zoom-api/methods/#operation/pastMeetingParticipants
 */
export const PARTICIPANT_PAGE_INFO_OUTPUT_PROPERTIES = {
  pageSize: { type: 'number', description: 'Number of records per page' },
  totalRecords: { type: 'number', description: 'Total number of records' },
  nextPageToken: { type: 'string', description: 'Token for next page of results' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete page info output definition for participant lists
 */
export const PARTICIPANT_PAGE_INFO_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pagination information',
  properties: PARTICIPANT_PAGE_INFO_OUTPUT_PROPERTIES,
}

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

// Recording types
export interface ZoomRecordingFile {
  id: string
  meeting_id: string
  recording_start: string
  recording_end: string
  file_type: string
  file_extension: string
  file_size: number
  play_url?: string
  download_url?: string
  status: string
  recording_type: string
}

export interface ZoomRecording {
  uuid: string
  id: number
  account_id: string
  host_id: string
  topic: string
  type: number
  start_time: string
  duration: number
  total_size: number
  recording_count: number
  share_url?: string
  recording_files: ZoomRecordingFile[]
}

// List Recordings tool types
export interface ZoomListRecordingsParams extends ZoomBaseParams {
  userId: string
  from?: string
  to?: string
  pageSize?: number
  nextPageToken?: string
  trash?: boolean
  trashType?: 'meeting_recordings' | 'recording_file'
}

export interface ZoomListRecordingsResponse extends ToolResponse {
  output: {
    recordings: ZoomRecording[]
    pageInfo: {
      from: string
      to: string
      pageSize: number
      totalRecords: number
      nextPageToken?: string
    }
  }
}

// Get Meeting Recordings tool types
export interface ZoomGetMeetingRecordingsParams extends ZoomBaseParams {
  meetingId: string
  includeFolderItems?: boolean
  ttl?: number
  downloadFiles?: boolean
}

export interface ZoomGetMeetingRecordingsResponse extends ToolResponse {
  output: {
    recording: ZoomRecording
    files?: ToolFileData[]
  }
}

// Delete Recording tool types
export interface ZoomDeleteRecordingParams extends ZoomBaseParams {
  meetingId: string
  recordingId?: string
  action?: 'trash' | 'delete'
}

export interface ZoomDeleteRecordingResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

// Participant types
export interface ZoomParticipant {
  id: string
  user_id?: string
  name: string
  user_email?: string
  join_time: string
  leave_time?: string
  duration: number
  attentiveness_score?: string
  failover?: boolean
  status?: string
}

// List Past Participants tool types
export interface ZoomListPastParticipantsParams extends ZoomBaseParams {
  meetingId: string
  pageSize?: number
  nextPageToken?: string
}

export interface ZoomListPastParticipantsResponse extends ToolResponse {
  output: {
    participants: ZoomParticipant[]
    pageInfo: {
      pageSize: number
      totalRecords: number
      nextPageToken?: string
    }
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
  | ZoomListRecordingsResponse
  | ZoomGetMeetingRecordingsResponse
  | ZoomDeleteRecordingResponse
  | ZoomListPastParticipantsResponse
