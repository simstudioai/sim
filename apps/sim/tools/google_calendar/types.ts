import type { ToolResponse } from '@/tools/types'

export const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'

export interface CalendarAttendee {
  id?: string
  email: string
  displayName?: string
  organizer?: boolean
  self?: boolean
  resource?: boolean
  optional?: boolean
  responseStatus: string
  comment?: string
  additionalGuests?: number
}

interface BaseGoogleCalendarParams {
  accessToken: string
  calendarId?: string
}

export interface GoogleCalendarCreateParams extends BaseGoogleCalendarParams {
  summary: string
  description?: string
  location?: string
  startDateTime: string
  endDateTime: string
  timeZone?: string
  attendees?: string[]
  sendUpdates?: 'all' | 'externalOnly' | 'none'
  recurrence?: string | string[]
  addGoogleMeet?: boolean
}

export interface GoogleCalendarListParams extends BaseGoogleCalendarParams {
  timeMin?: string
  timeMax?: string
  q?: string
  maxResults?: number
  pageToken?: string
  singleEvents?: boolean
  orderBy?: 'startTime' | 'updated'
  showDeleted?: boolean
}

export interface GoogleCalendarGetParams extends BaseGoogleCalendarParams {
  eventId: string
}

export interface GoogleCalendarUpdateParams extends BaseGoogleCalendarParams {
  eventId: string
  summary?: string
  description?: string
  location?: string
  startDateTime?: string
  endDateTime?: string
  timeZone?: string
  attendees?: string[]
  sendUpdates?: 'all' | 'externalOnly' | 'none'
  recurrence?: string | string[]
  addGoogleMeet?: boolean
}

export interface GoogleCalendarDeleteParams extends BaseGoogleCalendarParams {
  eventId: string
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

export interface GoogleCalendarQuickAddParams extends BaseGoogleCalendarParams {
  text: string
  attendees?: string[]
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

export interface GoogleCalendarInviteParams extends BaseGoogleCalendarParams {
  eventId: string
  attendees: string[]
  sendUpdates?: 'all' | 'externalOnly' | 'none'
  replaceExisting?: boolean
}

interface GoogleCalendarMoveParams extends BaseGoogleCalendarParams {
  eventId: string
  destinationCalendarId: string
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

interface GoogleCalendarInstancesParams extends BaseGoogleCalendarParams {
  eventId: string
  timeMin?: string
  timeMax?: string
  maxResults?: number
  pageToken?: string
  showDeleted?: boolean
}

export interface GoogleCalendarFreeBusyParams {
  accessToken: string
  calendarIds: string
  timeMin: string
  timeMax: string
  timeZone?: string
}

interface GoogleCalendarListCalendarsParams {
  accessToken: string
  minAccessRole?: 'freeBusyReader' | 'reader' | 'writer' | 'owner'
  maxResults?: number
  pageToken?: string
  showDeleted?: boolean
  showHidden?: boolean
}

export interface GoogleCalendarCreateCalendarParams {
  accessToken: string
  summary: string
  description?: string
  location?: string
  timeZone?: string
}

type GoogleCalendarAclRole = 'freeBusyReader' | 'reader' | 'writer' | 'owner'
type GoogleCalendarAclScopeType = 'user' | 'group' | 'domain' | 'default'

export interface GoogleCalendarShareCalendarParams {
  accessToken: string
  calendarId?: string
  role: GoogleCalendarAclRole
  scopeType: GoogleCalendarAclScopeType
  scopeValue?: string
  sendNotifications?: boolean
}

export interface GoogleCalendarListAclParams {
  accessToken: string
  calendarId?: string
  maxResults?: number
  pageToken?: string
  showDeleted?: boolean
}

export interface GoogleCalendarUnshareCalendarParams {
  accessToken: string
  calendarId?: string
  ruleId: string
}

export type GoogleCalendarToolParams =
  | GoogleCalendarCreateParams
  | GoogleCalendarListParams
  | GoogleCalendarGetParams
  | GoogleCalendarUpdateParams
  | GoogleCalendarDeleteParams
  | GoogleCalendarQuickAddParams
  | GoogleCalendarInviteParams
  | GoogleCalendarMoveParams
  | GoogleCalendarInstancesParams
  | GoogleCalendarFreeBusyParams
  | GoogleCalendarListCalendarsParams
  | GoogleCalendarCreateCalendarParams
  | GoogleCalendarShareCalendarParams
  | GoogleCalendarListAclParams
  | GoogleCalendarUnshareCalendarParams

interface EventMetadata {
  id: string
  htmlLink: string
  hangoutLink?: string
  status: string
  summary: string
  description?: string
  location?: string
  recurrence?: string[]
  start: {
    dateTime?: string
    date?: string
    timeZone?: string
  }
  end: {
    dateTime?: string
    date?: string
    timeZone?: string
  }
  attendees?: CalendarAttendee[]
  creator?: {
    email: string
    displayName?: string
  }
  organizer?: {
    email: string
    displayName?: string
  }
}

interface ListMetadata {
  nextPageToken?: string
  nextSyncToken?: string
  events: EventMetadata[]
  timeZone: string
}

interface GoogleCalendarToolResponse extends ToolResponse {
  output: {
    content: string
    metadata: EventMetadata | ListMetadata
  }
}

export interface GoogleCalendarCreateResponse extends ToolResponse {
  output: {
    content: string
    metadata: EventMetadata
  }
}

export interface GoogleCalendarListResponse extends ToolResponse {
  output: {
    content: string
    metadata: ListMetadata
  }
}

export interface GoogleCalendarGetResponse extends ToolResponse {
  output: {
    content: string
    metadata: EventMetadata
  }
}

export interface GoogleCalendarQuickAddResponse extends ToolResponse {
  output: {
    content: string
    metadata: EventMetadata
  }
}

export interface GoogleCalendarUpdateResponse extends ToolResponse {
  output: {
    content: string
    metadata: EventMetadata
  }
}

export interface GoogleCalendarInviteResponse extends ToolResponse {
  output: {
    content: string
    metadata: EventMetadata
  }
}

interface GoogleCalendarEvent {
  id: string
  status: string
  htmlLink: string
  created: string
  updated: string
  summary: string
  description?: string
  location?: string
  start: {
    dateTime?: string
    date?: string
    timeZone?: string
  }
  end: {
    dateTime?: string
    date?: string
    timeZone?: string
  }
  attendees?: CalendarAttendee[]
  creator?: {
    email: string
    displayName?: string
  }
  organizer?: {
    email: string
    displayName?: string
  }
  reminders?: {
    useDefault: boolean
    overrides?: Array<{
      method: string
      minutes: number
    }>
  }
}

interface GoogleCalendarEventDateTime {
  dateTime?: string
  date?: string
  timeZone?: string
}

interface GoogleCalendarConferenceCreateRequest {
  createRequest: {
    requestId: string
    conferenceSolutionKey: { type: string }
  }
}

export interface GoogleCalendarEventRequestBody {
  summary: string
  description?: string
  location?: string
  start: GoogleCalendarEventDateTime
  end: GoogleCalendarEventDateTime
  attendees?: Array<{
    email: string
  }>
  recurrence?: string[]
  conferenceData?: GoogleCalendarConferenceCreateRequest
}

export interface GoogleCalendarApiEventResponse {
  id: string
  status: string
  htmlLink: string
  hangoutLink?: string
  created?: string
  updated?: string
  summary: string
  description?: string
  location?: string
  recurrence?: string[]
  recurringEventId?: string
  start: {
    dateTime?: string
    date?: string
    timeZone?: string
  }
  end: {
    dateTime?: string
    date?: string
    timeZone?: string
  }
  attendees?: CalendarAttendee[]
  creator?: {
    email: string
    displayName?: string
  }
  organizer?: {
    email: string
    displayName?: string
  }
  conferenceData?: Record<string, unknown>
  reminders?: {
    useDefault: boolean
    overrides?: Array<{
      method: string
      minutes: number
    }>
  }
}

export interface GoogleCalendarApiCalendarResponse {
  kind: string
  etag: string
  id: string
  summary: string
  description?: string
  location?: string
  timeZone?: string
}

export interface GoogleCalendarApiAclRule {
  kind: string
  etag: string
  id: string
  role: string
  scope: {
    type: string
    value?: string
  }
}

export interface GoogleCalendarApiAclListResponse {
  kind: string
  etag: string
  nextPageToken?: string
  items: GoogleCalendarApiAclRule[]
}

export interface GoogleCalendarApiListResponse {
  kind: string
  etag: string
  summary: string
  description?: string
  updated: string
  timeZone: string
  accessRole: string
  defaultReminders: Array<{
    method: string
    minutes: number
  }>
  nextPageToken?: string
  nextSyncToken?: string
  items: GoogleCalendarApiEventResponse[]
}

interface GoogleCalendarDeleteResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      eventId: string
      deleted: boolean
    }
  }
}

interface GoogleCalendarMoveResponse extends ToolResponse {
  output: {
    content: string
    metadata: EventMetadata
  }
}

interface GoogleCalendarInstancesResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      nextPageToken?: string
      timeZone: string
      instances: Array<
        EventMetadata & {
          recurringEventId: string
          originalStartTime: {
            dateTime?: string
            date?: string
            timeZone?: string
          }
        }
      >
    }
  }
}

export interface GoogleCalendarFreeBusyResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      timeMin: string
      timeMax: string
      calendars: Record<
        string,
        {
          busy: Array<{ start: string; end: string }>
          errors?: Array<{ domain: string; reason: string }>
        }
      >
    }
  }
}

export interface GoogleCalendarApiFreeBusyResponse {
  kind: string
  timeMin: string
  timeMax: string
  calendars: Record<
    string,
    {
      busy: Array<{ start: string; end: string }>
      errors?: Array<{ domain: string; reason: string }>
    }
  >
}

interface GoogleCalendarListCalendarsResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      nextPageToken?: string
      calendars: Array<{
        id: string
        summary: string
        description?: string
        location?: string
        timeZone: string
        accessRole: string
        backgroundColor: string
        foregroundColor: string
        primary?: boolean
        hidden?: boolean
        selected?: boolean
      }>
    }
  }
}

export interface GoogleCalendarCreateCalendarResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      id: string
      summary: string
      description?: string
      location?: string
      timeZone?: string
    }
  }
}

export interface GoogleCalendarShareCalendarResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      id: string
      role: string
      scope: { type: string; value?: string }
    }
  }
}

export interface GoogleCalendarListAclResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      nextPageToken?: string
      rules: Array<{ id: string; role: string; scope: { type: string; value?: string } }>
    }
  }
}

export interface GoogleCalendarUnshareCalendarResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      ruleId: string
      deleted: boolean
    }
  }
}

export type GoogleCalendarResponse =
  | GoogleCalendarCreateResponse
  | GoogleCalendarListResponse
  | GoogleCalendarGetResponse
  | GoogleCalendarQuickAddResponse
  | GoogleCalendarInviteResponse
  | GoogleCalendarUpdateResponse
  | GoogleCalendarDeleteResponse
  | GoogleCalendarMoveResponse
  | GoogleCalendarInstancesResponse
  | GoogleCalendarFreeBusyResponse
  | GoogleCalendarListCalendarsResponse
  | GoogleCalendarCreateCalendarResponse
  | GoogleCalendarShareCalendarResponse
  | GoogleCalendarListAclResponse
  | GoogleCalendarUnshareCalendarResponse
