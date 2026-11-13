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
  optionalAttendees?: string | string[]
  visibility?: GoogleCalendarEventVisibility
  transparency?: GoogleCalendarEventTransparency
  colorId?: string
  reminders?: string | GoogleCalendarReminderOverride[]
}

type GoogleCalendarEventVisibility = 'default' | 'public' | 'private' | 'confidential'
type GoogleCalendarEventTransparency = 'opaque' | 'transparent'

export interface GoogleCalendarReminderOverride {
  method: 'email' | 'popup'
  minutes: number
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
  timeZone?: string
  updatedMin?: string
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
  visibility?: GoogleCalendarEventVisibility
  transparency?: GoogleCalendarEventTransparency
  colorId?: string
  reminders?: string | GoogleCalendarReminderOverride[]
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

export interface GoogleCalendarRespondParams extends BaseGoogleCalendarParams {
  eventId: string
  responseStatus: 'accepted' | 'declined' | 'tentative'
  comment?: string
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

export interface GoogleCalendarFreeBusyParams {
  accessToken: string
  calendarIds: string
  timeMin: string
  timeMax: string
  timeZone?: string
}

export interface GoogleCalendarCreateCalendarParams {
  accessToken: string
  summary: string
  description?: string
  location?: string
  timeZone?: string
}

export type GoogleCalendarAclRole = 'freeBusyReader' | 'reader' | 'writer' | 'owner'
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

interface GoogleCalendarEventPerson {
  id?: string
  email: string
  displayName?: string
  self?: boolean
}

interface GoogleCalendarEventAttachment {
  fileUrl: string
  title?: string
  mimeType?: string
  iconLink?: string
  fileId?: string
}

/** Event fields returned by every event-shaped tool in addition to its core fields. */
export interface GoogleCalendarEventDetails {
  hangoutLink: string | null
  conferenceData: Record<string, unknown> | null
  recurrence: string[] | null
  recurringEventId: string | null
  originalStartTime: GoogleCalendarEventDateTime | null
  reminders: GoogleCalendarApiEventResponse['reminders'] | null
  visibility: string | null
  transparency: string | null
  colorId: string | null
  eventType: string | null
  iCalUID: string | null
  created: string | null
  updated: string | null
  attachments: GoogleCalendarEventAttachment[] | null
}

interface EventMetadata extends Partial<GoogleCalendarEventDetails> {
  id: string
  htmlLink: string
  hangoutLink?: string | null
  status: string
  summary: string
  description?: string
  location?: string
  recurrence?: string[] | null
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

export interface GoogleCalendarRespondResponse extends ToolResponse {
  output: {
    content: string
    metadata: EventMetadata
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
    optional?: boolean
  }>
  recurrence?: string[]
  conferenceData?: GoogleCalendarConferenceCreateRequest
  visibility?: GoogleCalendarEventVisibility
  transparency?: GoogleCalendarEventTransparency
  colorId?: string
  reminders?: {
    useDefault: boolean
    overrides?: GoogleCalendarReminderOverride[]
  }
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
  originalStartTime?: GoogleCalendarEventDateTime
  visibility?: string
  transparency?: string
  colorId?: string
  eventType?: string
  iCalUID?: string
  attachments?: GoogleCalendarEventAttachment[]
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
  creator?: GoogleCalendarEventPerson
  organizer?: GoogleCalendarEventPerson
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
