import type { ToolResponse } from '../types'

// Base parameters shared by all operations
interface BaseGoogleCalendarParams {
  accessToken: string
  calendarId?: string // defaults to 'primary' if not provided
}

// Create Event parameters
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

// List Events parameters
export interface GoogleCalendarListParams extends BaseGoogleCalendarParams {
  timeMin?: string // RFC3339 timestamp
  timeMax?: string // RFC3339 timestamp
  maxResults?: number
  singleEvents?: boolean
  orderBy?: 'startTime' | 'updated'
  showDeleted?: boolean
}

// Get Event parameters
export interface GoogleCalendarGetParams extends BaseGoogleCalendarParams {
  eventId: string
}

// Update Event parameters
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

// Delete Event parameters
export interface GoogleCalendarDeleteParams extends BaseGoogleCalendarParams {
  eventId: string
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

// Quick Add parameters
export interface GoogleCalendarQuickAddParams extends BaseGoogleCalendarParams {
  text: string // Natural language text like "Meeting with John tomorrow at 3pm"
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

// Union type for all Google Calendar tool parameters
export type GoogleCalendarToolParams =
  | GoogleCalendarCreateParams
  | GoogleCalendarListParams
  | GoogleCalendarGetParams
  | GoogleCalendarUpdateParams
  | GoogleCalendarDeleteParams
  | GoogleCalendarQuickAddParams

// Response metadata
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
  attendees?: Array<{
    email: string
    displayName?: string
    responseStatus: string
  }>
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

// Response format
export interface GoogleCalendarToolResponse extends ToolResponse {
  output: {
    content: string
    metadata: EventMetadata | ListMetadata
  }
}

// Calendar Event Interface (for API responses)
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
  attendees?: Array<{
    email: string
    displayName?: string
    responseStatus: string
    optional?: boolean
  }>
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
