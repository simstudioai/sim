import { ZoomIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ZoomResponse } from '@/tools/zoom/types'

export const ZoomBlock: BlockConfig<ZoomResponse> = {
  type: 'zoom',
  name: 'Zoom',
  description: 'Create and manage Zoom meetings and recordings',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Zoom into workflows. Create, list, update, and delete Zoom meetings. Get meeting details, invitations, recordings, and participants. Manage cloud recordings programmatically.',
  docsLink: 'https://docs.sim.ai/tools/zoom',
  category: 'tools',
  bgColor: '#2D8CFF',
  icon: ZoomIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Meeting', id: 'zoom_create_meeting' },
        { label: 'List Meetings', id: 'zoom_list_meetings' },
        { label: 'Get Meeting', id: 'zoom_get_meeting' },
        { label: 'Update Meeting', id: 'zoom_update_meeting' },
        { label: 'Delete Meeting', id: 'zoom_delete_meeting' },
        { label: 'Get Meeting Invitation', id: 'zoom_get_meeting_invitation' },
        { label: 'List Recordings', id: 'zoom_list_recordings' },
        { label: 'Get Meeting Recordings', id: 'zoom_get_meeting_recordings' },
        { label: 'Delete Recording', id: 'zoom_delete_recording' },
        { label: 'List Past Participants', id: 'zoom_list_past_participants' },
      ],
      value: () => 'zoom_create_meeting',
    },
    {
      id: 'credential',
      title: 'Zoom Account',
      type: 'oauth-input',
      serviceId: 'zoom',
      requiredScopes: [
        'user:read:user',
        'meeting:write:meeting',
        'meeting:read:meeting',
        'meeting:read:list_meetings',
        'meeting:update:meeting',
        'meeting:delete:meeting',
        'meeting:read:invitation',
        'meeting:read:list_past_participants',
        'cloud_recording:read:list_user_recordings',
        'cloud_recording:read:list_recording_files',
        'cloud_recording:delete:recording_file',
      ],
      placeholder: 'Select Zoom account',
      required: true,
    },
    // User ID for create/list operations
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'me (or user ID/email)',
      required: true,
      condition: {
        field: 'operation',
        value: ['zoom_create_meeting', 'zoom_list_meetings', 'zoom_list_recordings'],
      },
    },
    // Meeting ID for get/update/delete/invitation/recordings/participants operations
    {
      id: 'meetingId',
      title: 'Meeting ID',
      type: 'short-input',
      placeholder: 'Enter meeting ID',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'zoom_get_meeting',
          'zoom_update_meeting',
          'zoom_delete_meeting',
          'zoom_get_meeting_invitation',
          'zoom_get_meeting_recordings',
          'zoom_delete_recording',
          'zoom_list_past_participants',
        ],
      },
    },
    // Topic for create/update
    {
      id: 'topic',
      title: 'Topic',
      type: 'short-input',
      placeholder: 'Meeting topic',
      required: true,
      condition: {
        field: 'operation',
        value: ['zoom_create_meeting'],
      },
    },
    {
      id: 'topicUpdate',
      title: 'Topic',
      type: 'short-input',
      placeholder: 'Meeting topic (optional)',
      condition: {
        field: 'operation',
        value: ['zoom_update_meeting'],
      },
    },
    // Meeting type
    {
      id: 'type',
      title: 'Meeting Type',
      type: 'dropdown',
      options: [
        { label: 'Scheduled', id: '2' },
        { label: 'Instant', id: '1' },
        { label: 'Recurring (no fixed time)', id: '3' },
        { label: 'Recurring (fixed time)', id: '8' },
      ],
      value: () => '2',
      condition: {
        field: 'operation',
        value: ['zoom_create_meeting', 'zoom_update_meeting'],
      },
    },
    // Start time
    {
      id: 'startTime',
      title: 'Start Time',
      type: 'short-input',
      placeholder: '2025-06-03T10:00:00Z',
      condition: {
        field: 'operation',
        value: ['zoom_create_meeting', 'zoom_update_meeting'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:mm:ssZ (UTC timezone).
This is for scheduling a Zoom meeting start time.
Examples:
- "tomorrow at 10am" -> Calculate tomorrow's date at 10:00:00Z (adjust for user's timezone)
- "next Monday at 2pm" -> Calculate next Monday at 14:00:00Z
- "in 1 hour" -> Calculate 1 hour from now
- "Friday at 3:30pm" -> Calculate next Friday at 15:30:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder:
          'Describe the meeting time (e.g., "tomorrow at 10am", "next Monday at 2pm")...',
        generationType: 'timestamp',
      },
    },
    // Duration
    {
      id: 'duration',
      title: 'Duration (minutes)',
      type: 'short-input',
      placeholder: '30',
      condition: {
        field: 'operation',
        value: ['zoom_create_meeting', 'zoom_update_meeting'],
      },
    },
    // Timezone
    {
      id: 'timezone',
      title: 'Timezone',
      type: 'short-input',
      placeholder: 'America/Los_Angeles',
      condition: {
        field: 'operation',
        value: ['zoom_create_meeting', 'zoom_update_meeting'],
      },
    },
    // Password
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Meeting password',
      condition: {
        field: 'operation',
        value: ['zoom_create_meeting', 'zoom_update_meeting'],
      },
    },
    // Agenda
    {
      id: 'agenda',
      title: 'Agenda',
      type: 'long-input',
      placeholder: 'Meeting agenda',
      condition: {
        field: 'operation',
        value: ['zoom_create_meeting', 'zoom_update_meeting'],
      },
    },
    // Meeting settings
    {
      id: 'hostVideo',
      title: 'Host Video',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['zoom_create_meeting', 'zoom_update_meeting'],
      },
    },
    {
      id: 'participantVideo',
      title: 'Participant Video',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['zoom_create_meeting', 'zoom_update_meeting'],
      },
    },
    {
      id: 'joinBeforeHost',
      title: 'Join Before Host',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['zoom_create_meeting', 'zoom_update_meeting'],
      },
    },
    {
      id: 'muteUponEntry',
      title: 'Mute Upon Entry',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['zoom_create_meeting', 'zoom_update_meeting'],
      },
    },
    {
      id: 'waitingRoom',
      title: 'Waiting Room',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['zoom_create_meeting', 'zoom_update_meeting'],
      },
    },
    {
      id: 'autoRecording',
      title: 'Auto Recording',
      type: 'dropdown',
      options: [
        { label: 'None', id: 'none' },
        { label: 'Local', id: 'local' },
        { label: 'Cloud', id: 'cloud' },
      ],
      value: () => 'none',
      condition: {
        field: 'operation',
        value: ['zoom_create_meeting', 'zoom_update_meeting'],
      },
    },
    // List meetings filter
    {
      id: 'listType',
      title: 'Meeting Type Filter',
      type: 'dropdown',
      options: [
        { label: 'Scheduled', id: 'scheduled' },
        { label: 'Live', id: 'live' },
        { label: 'Upcoming', id: 'upcoming' },
        { label: 'Upcoming Meetings', id: 'upcoming_meetings' },
        { label: 'Previous Meetings', id: 'previous_meetings' },
      ],
      value: () => 'scheduled',
      condition: {
        field: 'operation',
        value: ['zoom_list_meetings'],
      },
    },
    // Pagination
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: 'Number of results (max 300)',
      condition: {
        field: 'operation',
        value: ['zoom_list_meetings', 'zoom_list_recordings', 'zoom_list_past_participants'],
      },
    },
    {
      id: 'nextPageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Token for next page',
      condition: {
        field: 'operation',
        value: ['zoom_list_meetings', 'zoom_list_recordings', 'zoom_list_past_participants'],
      },
    },
    // Recording date range
    {
      id: 'fromDate',
      title: 'From Date',
      type: 'short-input',
      placeholder: 'yyyy-mm-dd (within last 6 months)',
      condition: {
        field: 'operation',
        value: ['zoom_list_recordings'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date string based on the user's description.
The date should be in the format: yyyy-mm-dd (e.g., 2024-01-15).
This is for filtering Zoom recordings from this date (must be within last 6 months).
Examples:
- "last month" -> Calculate 30 days ago in yyyy-mm-dd format
- "beginning of this month" -> First day of current month in yyyy-mm-dd format
- "2 weeks ago" -> Calculate 14 days ago in yyyy-mm-dd format
- "start of last week" -> Calculate the Monday of last week

Return ONLY the date string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start date (e.g., "last month", "2 weeks ago")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'toDate',
      title: 'To Date',
      type: 'short-input',
      placeholder: 'yyyy-mm-dd',
      condition: {
        field: 'operation',
        value: ['zoom_list_recordings'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a date string based on the user's description.
The date should be in the format: yyyy-mm-dd (e.g., 2024-01-15).
This is for filtering Zoom recordings up to this date.
Examples:
- "today" -> Today's date in yyyy-mm-dd format
- "yesterday" -> Yesterday's date in yyyy-mm-dd format
- "end of last week" -> Calculate the Sunday of last week
- "end of this month" -> Last day of current month

Return ONLY the date string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end date (e.g., "today", "yesterday")...',
        generationType: 'timestamp',
      },
    },
    // Recording ID for delete
    {
      id: 'recordingId',
      title: 'Recording ID',
      type: 'short-input',
      placeholder: 'Specific recording file ID (optional)',
      condition: {
        field: 'operation',
        value: ['zoom_delete_recording'],
      },
    },
    // Delete action
    {
      id: 'deleteAction',
      title: 'Delete Action',
      type: 'dropdown',
      options: [
        { label: 'Move to Trash', id: 'trash' },
        { label: 'Permanently Delete', id: 'delete' },
      ],
      value: () => 'trash',
      condition: {
        field: 'operation',
        value: ['zoom_delete_recording'],
      },
    },
    // Delete options
    {
      id: 'occurrenceId',
      title: 'Occurrence ID',
      type: 'short-input',
      placeholder: 'For recurring meetings',
      condition: {
        field: 'operation',
        value: ['zoom_get_meeting', 'zoom_delete_meeting'],
      },
    },
    {
      id: 'cancelMeetingReminder',
      title: 'Send Cancellation Email',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['zoom_delete_meeting'],
      },
    },
  ],
  tools: {
    access: [
      'zoom_create_meeting',
      'zoom_list_meetings',
      'zoom_get_meeting',
      'zoom_update_meeting',
      'zoom_delete_meeting',
      'zoom_get_meeting_invitation',
      'zoom_list_recordings',
      'zoom_get_meeting_recordings',
      'zoom_delete_recording',
      'zoom_list_past_participants',
    ],
    config: {
      tool: (params) => {
        return params.operation || 'zoom_create_meeting'
      },
      params: (params) => {
        const baseParams: Record<string, any> = {
          credential: params.credential,
        }

        switch (params.operation) {
          case 'zoom_create_meeting':
            if (!params.userId?.trim()) {
              throw new Error('User ID is required.')
            }
            if (!params.topic?.trim()) {
              throw new Error('Topic is required.')
            }
            return {
              ...baseParams,
              userId: params.userId.trim(),
              topic: params.topic.trim(),
              type: params.type ? Number(params.type) : 2,
              startTime: params.startTime,
              duration: params.duration ? Number(params.duration) : undefined,
              timezone: params.timezone,
              password: params.password,
              agenda: params.agenda,
              hostVideo: params.hostVideo,
              participantVideo: params.participantVideo,
              joinBeforeHost: params.joinBeforeHost,
              muteUponEntry: params.muteUponEntry,
              waitingRoom: params.waitingRoom,
              autoRecording: params.autoRecording !== 'none' ? params.autoRecording : undefined,
            }

          case 'zoom_list_meetings':
            if (!params.userId?.trim()) {
              throw new Error('User ID is required.')
            }
            return {
              ...baseParams,
              userId: params.userId.trim(),
              type: params.listType,
              pageSize: params.pageSize ? Number(params.pageSize) : undefined,
              nextPageToken: params.nextPageToken,
            }

          case 'zoom_get_meeting':
            if (!params.meetingId?.trim()) {
              throw new Error('Meeting ID is required.')
            }
            return {
              ...baseParams,
              meetingId: params.meetingId.trim(),
              occurrenceId: params.occurrenceId,
            }

          case 'zoom_update_meeting':
            if (!params.meetingId?.trim()) {
              throw new Error('Meeting ID is required.')
            }
            return {
              ...baseParams,
              meetingId: params.meetingId.trim(),
              topic: params.topicUpdate,
              type: params.type ? Number(params.type) : undefined,
              startTime: params.startTime,
              duration: params.duration ? Number(params.duration) : undefined,
              timezone: params.timezone,
              password: params.password,
              agenda: params.agenda,
              hostVideo: params.hostVideo,
              participantVideo: params.participantVideo,
              joinBeforeHost: params.joinBeforeHost,
              muteUponEntry: params.muteUponEntry,
              waitingRoom: params.waitingRoom,
              autoRecording: params.autoRecording !== 'none' ? params.autoRecording : undefined,
            }

          case 'zoom_delete_meeting':
            if (!params.meetingId?.trim()) {
              throw new Error('Meeting ID is required.')
            }
            return {
              ...baseParams,
              meetingId: params.meetingId.trim(),
              occurrenceId: params.occurrenceId,
              cancelMeetingReminder: params.cancelMeetingReminder,
            }

          case 'zoom_get_meeting_invitation':
            if (!params.meetingId?.trim()) {
              throw new Error('Meeting ID is required.')
            }
            return {
              ...baseParams,
              meetingId: params.meetingId.trim(),
            }

          case 'zoom_list_recordings':
            if (!params.userId?.trim()) {
              throw new Error('User ID is required.')
            }
            return {
              ...baseParams,
              userId: params.userId.trim(),
              from: params.fromDate,
              to: params.toDate,
              pageSize: params.pageSize ? Number(params.pageSize) : undefined,
              nextPageToken: params.nextPageToken,
            }

          case 'zoom_get_meeting_recordings':
            if (!params.meetingId?.trim()) {
              throw new Error('Meeting ID is required.')
            }
            return {
              ...baseParams,
              meetingId: params.meetingId.trim(),
            }

          case 'zoom_delete_recording':
            if (!params.meetingId?.trim()) {
              throw new Error('Meeting ID is required.')
            }
            return {
              ...baseParams,
              meetingId: params.meetingId.trim(),
              recordingId: params.recordingId,
              action: params.deleteAction,
            }

          case 'zoom_list_past_participants':
            if (!params.meetingId?.trim()) {
              throw new Error('Meeting ID is required.')
            }
            return {
              ...baseParams,
              meetingId: params.meetingId.trim(),
              pageSize: params.pageSize ? Number(params.pageSize) : undefined,
              nextPageToken: params.nextPageToken,
            }

          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Zoom access token' },
    userId: { type: 'string', description: 'User ID or email (use "me" for authenticated user)' },
    meetingId: { type: 'string', description: 'Meeting ID' },
    topic: { type: 'string', description: 'Meeting topic' },
    topicUpdate: { type: 'string', description: 'Meeting topic for update' },
    type: { type: 'string', description: 'Meeting type' },
    startTime: { type: 'string', description: 'Start time in ISO 8601 format' },
    duration: { type: 'string', description: 'Duration in minutes' },
    timezone: { type: 'string', description: 'Timezone' },
    password: { type: 'string', description: 'Meeting password' },
    agenda: { type: 'string', description: 'Meeting agenda' },
    hostVideo: { type: 'boolean', description: 'Host video on' },
    participantVideo: { type: 'boolean', description: 'Participant video on' },
    joinBeforeHost: { type: 'boolean', description: 'Allow join before host' },
    muteUponEntry: { type: 'boolean', description: 'Mute upon entry' },
    waitingRoom: { type: 'boolean', description: 'Enable waiting room' },
    autoRecording: { type: 'string', description: 'Auto recording setting' },
    listType: { type: 'string', description: 'Meeting type filter for list' },
    pageSize: { type: 'string', description: 'Page size for list' },
    nextPageToken: { type: 'string', description: 'Page token for pagination' },
    occurrenceId: { type: 'string', description: 'Occurrence ID for recurring meetings' },
    cancelMeetingReminder: { type: 'boolean', description: 'Send cancellation email' },
    fromDate: { type: 'string', description: 'Start date for recordings list (yyyy-mm-dd)' },
    toDate: { type: 'string', description: 'End date for recordings list (yyyy-mm-dd)' },
    recordingId: { type: 'string', description: 'Specific recording file ID' },
    deleteAction: { type: 'string', description: 'Delete action (trash or delete)' },
  },
  outputs: {
    // Success indicator
    success: { type: 'boolean', description: 'Operation success status' },
    // Meeting outputs
    meeting: { type: 'json', description: 'Meeting data (create_meeting, get_meeting)' },
    meetings: { type: 'json', description: 'List of meetings (list_meetings)' },
    // Invitation
    invitation: { type: 'string', description: 'Meeting invitation text (get_meeting_invitation)' },
    // Recording outputs
    recording: { type: 'json', description: 'Recording data (get_meeting_recordings)' },
    recordings: { type: 'json', description: 'List of recordings (list_recordings)' },
    // Participant outputs
    participants: { type: 'json', description: 'List of participants (list_past_participants)' },
    // Pagination
    pageInfo: { type: 'json', description: 'Pagination information' },
  },
}
