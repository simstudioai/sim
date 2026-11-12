import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Webex API responses.
 * Based on the official Webex REST API documentation:
 * - https://developer.webex.com/docs/api/v1/messages
 * - https://developer.webex.com/docs/api/v1/rooms
 * - https://developer.webex.com/docs/api/v1/meetings
 */

// Message outputs

export const MESSAGE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Message ID' },
  roomId: { type: 'string', description: 'Room ID where the message was sent' },
  roomType: { type: 'string', description: 'Room type: direct or group' },
  text: { type: 'string', description: 'Plain text of the message' },
  markdown: { type: 'string', description: 'Markdown text of the message', optional: true },
  personId: { type: 'string', description: 'Sender person ID' },
  personEmail: { type: 'string', description: 'Sender email address' },
  created: { type: 'string', description: 'ISO 8601 creation timestamp' },
} as const satisfies Record<string, OutputProperty>

export const MESSAGES_LIST_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of Webex messages',
  items: {
    type: 'object',
    properties: MESSAGE_OUTPUT_PROPERTIES,
  },
}

// Room outputs

export const ROOM_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Room ID' },
  title: { type: 'string', description: 'Room title' },
  type: { type: 'string', description: 'Room type: direct or group' },
  isLocked: { type: 'boolean', description: 'Whether the room is locked' },
  teamId: { type: 'string', description: 'Team ID if room belongs to a team', optional: true },
  lastActivity: { type: 'string', description: 'ISO 8601 timestamp of last activity' },
  creatorId: { type: 'string', description: 'Creator person ID' },
  created: { type: 'string', description: 'ISO 8601 creation timestamp' },
} as const satisfies Record<string, OutputProperty>

export const ROOMS_LIST_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of Webex rooms',
  items: {
    type: 'object',
    properties: ROOM_OUTPUT_PROPERTIES,
  },
}

// Membership outputs

const MEMBERSHIP_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Membership ID' },
  roomId: { type: 'string', description: 'Room ID' },
  personId: { type: 'string', description: 'Person ID' },
  personEmail: { type: 'string', description: 'Person email address' },
  personDisplayName: { type: 'string', description: 'Person display name' },
  personOrgId: { type: 'string', description: 'Person org ID' },
  isModerator: { type: 'boolean', description: 'Whether they are a moderator' },
  isMonitor: { type: 'boolean', description: 'Whether they are a monitor' },
  created: { type: 'string', description: 'ISO 8601 creation timestamp' },
} as const satisfies Record<string, OutputProperty>

export const MEMBERSHIPS_LIST_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of room memberships',
  items: {
    type: 'object',
    properties: MEMBERSHIP_OUTPUT_PROPERTIES,
  },
}

// Person outputs

export const PERSON_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Person ID' },
  emails: {
    type: 'array',
    description: 'Email addresses',
    items: { type: 'string', description: 'Email address' },
  },
  displayName: { type: 'string', description: 'Display name' },
  nickName: { type: 'string', description: 'Nick name', optional: true },
  firstName: { type: 'string', description: 'First name', optional: true },
  lastName: { type: 'string', description: 'Last name', optional: true },
  avatar: { type: 'string', description: 'Avatar URL', optional: true },
  orgId: { type: 'string', description: 'Organisation ID' },
  status: { type: 'string', description: 'Presence status', optional: true },
  type: { type: 'string', description: 'Person type: person or bot' },
  created: { type: 'string', description: 'ISO 8601 creation timestamp' },
} as const satisfies Record<string, OutputProperty>

// Meeting outputs

export const MEETING_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Meeting ID' },
  meetingNumber: { type: 'string', description: 'Meeting number' },
  title: { type: 'string', description: 'Meeting title' },
  password: { type: 'string', description: 'Meeting password', optional: true },
  phoneAndVideoSystemPassword: {
    type: 'string',
    description: 'Numeric password for phone/video systems',
    optional: true,
  },
  meetingType: { type: 'string', description: 'Meeting type' },
  state: {
    type: 'string',
    description: 'Meeting state (scheduled, ready, lobby, inProgress, ended, missed, expired)',
  },
  timezone: { type: 'string', description: 'Timezone', optional: true },
  start: { type: 'string', description: 'ISO 8601 start time' },
  end: { type: 'string', description: 'ISO 8601 end time' },
  hostUserId: { type: 'string', description: 'Host user ID' },
  hostDisplayName: { type: 'string', description: 'Host display name', optional: true },
  hostEmail: { type: 'string', description: 'Host email', optional: true },
  webLink: { type: 'string', description: 'Meeting join URL', optional: true },
  sipAddress: { type: 'string', description: 'SIP address', optional: true },
  dialInIpAddress: { type: 'string', description: 'Dial-in IP address', optional: true },
  agenda: { type: 'string', description: 'Meeting agenda', optional: true },
  enabledAutoRecordMeeting: { type: 'boolean', description: 'Auto-record enabled', optional: true },
  allowAnyUserToBeCoHost: {
    type: 'boolean',
    description: 'Allow any user to be co-host',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const MEETINGS_LIST_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of Webex meetings',
  items: {
    type: 'object',
    properties: MEETING_OUTPUT_PROPERTIES,
  },
}

// Param interfaces

interface WebexBaseParams {
  accessToken: string
}

// Messages
export interface WebexSendMessageParams extends WebexBaseParams {
  roomId?: string
  toPersonId?: string
  toPersonEmail?: string
  text?: string
  markdown?: string
}

export interface WebexListMessagesParams extends WebexBaseParams {
  roomId: string
  max?: number
  before?: string
  beforeMessage?: string
}

export interface WebexGetMessageParams extends WebexBaseParams {
  messageId: string
}

export interface WebexDeleteMessageParams extends WebexBaseParams {
  messageId: string
}

// Rooms
export interface WebexListRoomsParams extends WebexBaseParams {
  max?: number
  type?: string
  sortBy?: string
}

export interface WebexCreateRoomParams extends WebexBaseParams {
  title: string
  teamId?: string
}

export interface WebexGetRoomParams extends WebexBaseParams {
  roomId: string
}

// Memberships
export interface WebexListMembersParams extends WebexBaseParams {
  roomId: string
  personEmail?: string
  max?: number
}

// People
export interface WebexGetPersonParams extends WebexBaseParams {
  personId: string
}

// Meetings
export interface WebexCreateMeetingParams extends WebexBaseParams {
  title: string
  start: string
  end: string
  agenda?: string
  password?: string
  timezone?: string
  enabledAutoRecordMeeting?: boolean
  allowAnyUserToBeCoHost?: boolean
  invitees?: string
}

export interface WebexListMeetingsParams extends WebexBaseParams {
  max?: number
  from?: string
  to?: string
  meetingType?: string
  state?: string
}

export interface WebexGetMeetingParams extends WebexBaseParams {
  meetingId: string
}

export interface WebexUpdateMeetingParams extends WebexBaseParams {
  meetingId: string
  title?: string
  start?: string
  end?: string
  agenda?: string
  password?: string
  timezone?: string
  enabledAutoRecordMeeting?: boolean
}

export interface WebexDeleteMeetingParams extends WebexBaseParams {
  meetingId: string
}

export type WebexSendMessageResponse = ToolResponse
export type WebexListMessagesResponse = ToolResponse
export type WebexGetMessageResponse = ToolResponse
export type WebexDeleteMessageResponse = ToolResponse
export type WebexListRoomsResponse = ToolResponse
export type WebexCreateRoomResponse = ToolResponse
export type WebexGetRoomResponse = ToolResponse
export type WebexListMembersResponse = ToolResponse
export type WebexGetPersonResponse = ToolResponse
export type WebexCreateMeetingResponse = ToolResponse
export type WebexListMeetingsResponse = ToolResponse
export type WebexGetMeetingResponse = ToolResponse
export type WebexUpdateMeetingResponse = ToolResponse
export type WebexDeleteMeetingResponse = ToolResponse
