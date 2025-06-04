import type { ToolResponse } from '../types'

export const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'

// Shared attendee interface that matches Google Calendar API specification
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
  calendarId?: string // defaults to 'primary' if not provided
}

export interface GoogleCalendarCreateParams extends BaseGoogleCalendarParams {
  summary: string
  description?: string
  location?: string
  startDateTime: string
  endDateTime: string
  timeZone?: string
  attendees?: string[] // Array of email addresses
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

export interface GoogleCalendarListParams extends BaseGoogleCalendarParams {
  timeMin?: string // RFC3339 timestamp
  timeMax?: string // RFC3339 timestamp
  maxResults?: number
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
}

export interface GoogleCalendarDeleteParams extends BaseGoogleCalendarParams {
  eventId: string
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

export interface GoogleCalendarQuickAddParams extends BaseGoogleCalendarParams {
  text: string // Natural language text like "Meeting with John tomorrow at 3pm"
  attendees?: string[] // Array of email addresses (comma-separated string also accepted)
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

export interface GoogleCalendarInviteParams extends BaseGoogleCalendarParams {
  eventId: string
  attendees: string[] // Array of email addresses to invite
  sendUpdates?: 'all' | 'externalOnly' | 'none'
  replaceExisting?: boolean // Whether to replace existing attendees or add to them
}

export type GoogleCalendarToolParams =
  | GoogleCalendarCreateParams
  | GoogleCalendarListParams
  | GoogleCalendarGetParams
  | GoogleCalendarUpdateParams
  | GoogleCalendarDeleteParams
  | GoogleCalendarQuickAddParams
  | GoogleCalendarInviteParams

interface EventMetadata {
  id: string
  htmlLink: string
  status: string
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
}

interface ListMetadata {
  nextPageToken?: string
  nextSyncToken?: string
  events: EventMetadata[]
  timeZone: string
}

export interface GoogleCalendarToolResponse extends ToolResponse {
  output: {
    content: string
    metadata: EventMetadata | ListMetadata
  }
}

// Specific response types for each operation
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

export interface GoogleCalendarEvent {
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

export interface GoogleCalendarEventRequestBody {
  summary: string
  description?: string
  location?: string
  start: {
    dateTime: string
    timeZone?: string
  }
  end: {
    dateTime: string
    timeZone?: string
  }
  attendees?: Array<{
    email: string
  }>
}

export interface GoogleCalendarApiEventResponse {
  id: string
  status: string
  htmlLink: string
  created?: string
  updated?: string
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
