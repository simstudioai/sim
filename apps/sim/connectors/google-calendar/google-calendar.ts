import { createLogger } from '@sim/logger'
import { GoogleCalendarIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, parseTagDate } from '@/connectors/utils'

const logger = createLogger('GoogleCalendarConnector')

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'
const DEFAULT_MAX_EVENTS = 500
const DEFAULT_RANGE_DAYS = 30
const PAGE_SIZE = 250

interface CalendarEventTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

interface CalendarAttendee {
  email?: string
  displayName?: string
  responseStatus?: string
  self?: boolean
  resource?: boolean
  optional?: boolean
}

interface CalendarEvent {
  id: string
  status?: string
  htmlLink?: string
  created?: string
  updated?: string
  summary?: string
  description?: string
  location?: string
  creator?: { email?: string; displayName?: string }
  organizer?: { email?: string; displayName?: string; self?: boolean }
  start?: CalendarEventTime
  end?: CalendarEventTime
  attendees?: CalendarAttendee[]
  recurringEventId?: string
  eventType?: string
}

/**
 * Formats a CalendarEventTime into a human-readable string.
 * All-day events use the date field; timed events use dateTime.
 */
function formatEventTime(eventTime?: CalendarEventTime): string {
  if (!eventTime) return 'Unknown'
  if (eventTime.dateTime) {
    const date = new Date(eventTime.dateTime)
    return date.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: eventTime.timeZone || undefined,
    })
  }
  if (eventTime.date) {
    const date = new Date(`${eventTime.date}T00:00:00`)
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }
  return 'Unknown'
}

/**
 * Determines whether the event is all-day based on whether `date` (not `dateTime`) is used.
 */
function isAllDayEvent(event: CalendarEvent): boolean {
  return Boolean(event.start?.date && !event.start?.dateTime)
}

/**
 * Formats attendees into a comma-separated list of names/emails.
 */
function formatAttendees(attendees?: CalendarAttendee[]): string {
  if (!attendees || attendees.length === 0) return ''
  return attendees
    .filter((a) => !a.resource)
    .map((a) => a.displayName || a.email || 'Unknown')
    .join(', ')
}

/**
 * Formats an organizer into a display string.
 */
function formatOrganizer(organizer?: { email?: string; displayName?: string }): string {
  if (!organizer) return ''
  if (organizer.displayName && organizer.email) {
    return `${organizer.displayName} (${organizer.email})`
  }
  return organizer.displayName || organizer.email || ''
}

/**
 * Builds a readable content string from a calendar event.
 */
function eventToContent(event: CalendarEvent): string {
  const parts: string[] = []

  parts.push(`Event: ${event.summary || 'Untitled Event'}`)

  if (isAllDayEvent(event)) {
    parts.push(`Date: ${formatEventTime(event.start)} (All Day)`)
  } else {
    parts.push(`Date: ${formatEventTime(event.start)} - ${formatEventTime(event.end)}`)
  }

  if (event.location) {
    parts.push(`Location: ${event.location}`)
  }

  const organizer = formatOrganizer(event.organizer)
  if (organizer) {
    parts.push(`Organizer: ${organizer}`)
  }

  const attendees = formatAttendees(event.attendees)
  if (attendees) {
    parts.push(`Attendees: ${attendees}`)
  }

  if (event.description) {
    parts.push('')
    parts.push('Description:')
    parts.push(
      event.description
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
  }

  return parts.join('\n')
}

/**
 * Computes the default time range boundaries: 30 days in the past to 30 days in the future.
 */
function getDefaultTimeRange(): { timeMin: string; timeMax: string } {
  const now = new Date()
  const past = new Date(now)
  past.setDate(past.getDate() - DEFAULT_RANGE_DAYS)
  const future = new Date(now)
  future.setDate(future.getDate() + DEFAULT_RANGE_DAYS)
  return {
    timeMin: past.toISOString(),
    timeMax: future.toISOString(),
  }
}

/**
 * Parses the date range config into timeMin/timeMax values.
 */
function getTimeRange(sourceConfig: Record<string, unknown>): { timeMin: string; timeMax: string } {
  const dateRange = (sourceConfig.dateRange as string) || 'default'

  const now = new Date()

  switch (dateRange) {
    case 'past_only': {
      const past = new Date(now)
      past.setDate(past.getDate() - DEFAULT_RANGE_DAYS)
      return { timeMin: past.toISOString(), timeMax: now.toISOString() }
    }
    case 'future_only': {
      const future = new Date(now)
      future.setDate(future.getDate() + DEFAULT_RANGE_DAYS)
      return { timeMin: now.toISOString(), timeMax: future.toISOString() }
    }
    case 'past_90': {
      const past = new Date(now)
      past.setDate(past.getDate() - 90)
      const future = new Date(now)
      future.setDate(future.getDate() + 90)
      return { timeMin: past.toISOString(), timeMax: future.toISOString() }
    }
    default:
      return getDefaultTimeRange()
  }
}

/**
 * Converts a CalendarEvent to an ExternalDocument.
 */
async function eventToDocument(event: CalendarEvent): Promise<ExternalDocument | null> {
  if (event.status === 'cancelled') return null

  const content = eventToContent(event)
  if (!content.trim()) return null

  const contentHash = await computeContentHash(content)

  const startTime = event.start?.dateTime || event.start?.date || ''
  const attendeeCount = event.attendees?.filter((a) => !a.resource).length || 0

  return {
    externalId: event.id,
    title: event.summary || 'Untitled Event',
    content,
    mimeType: 'text/plain',
    sourceUrl: event.htmlLink || `https://calendar.google.com/calendar/event?eid=${event.id}`,
    contentHash,
    metadata: {
      startTime,
      endTime: event.end?.dateTime || event.end?.date || '',
      location: event.location || '',
      organizer: formatOrganizer(event.organizer),
      attendeeCount,
      isAllDay: isAllDayEvent(event),
      eventDate: startTime,
      updatedTime: event.updated,
      createdTime: event.created,
    },
  }
}

export const googleCalendarConnector: ConnectorConfig = {
  id: 'google_calendar',
  name: 'Google Calendar',
  description: 'Sync calendar events from Google Calendar into your knowledge base',
  version: '1.0.0',
  icon: GoogleCalendarIcon,

  auth: {
    mode: 'oauth',
    provider: 'google-calendar',
    requiredScopes: ['https://www.googleapis.com/auth/calendar'],
  },

  configFields: [
    {
      id: 'calendarSelector',
      title: 'Calendar',
      type: 'selector',
      selectorKey: 'google.calendar',
      canonicalParamId: 'calendarId',
      mode: 'basic',
      placeholder: 'Select a calendar',
      required: false,
      description: 'The calendar to sync from. Defaults to your primary calendar.',
    },
    {
      id: 'calendarId',
      title: 'Calendar ID',
      type: 'short-input',
      canonicalParamId: 'calendarId',
      mode: 'advanced',
      placeholder: 'e.g. primary (default: primary)',
      required: false,
      description: 'The calendar to sync from. Use "primary" for your main calendar.',
    },
    {
      id: 'dateRange',
      title: 'Date Range',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Last 30 days + next 30 days (default)', id: 'default' },
        { label: 'Past events only (last 30 days)', id: 'past_only' },
        { label: 'Future events only (next 30 days)', id: 'future_only' },
        { label: 'Extended range (90 days each way)', id: 'past_90' },
      ],
    },
    {
      id: 'searchQuery',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'e.g. standup, sprint review (optional)',
      required: false,
      description: 'Filter events by text search across all fields.',
    },
    {
      id: 'maxEvents',
      title: 'Max Events',
      type: 'short-input',
      required: false,
      placeholder: `e.g. 500 (default: ${DEFAULT_MAX_EVENTS})`,
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const calendarId = ((sourceConfig.calendarId as string) || 'primary').trim()
    const { timeMin, timeMax } = getTimeRange(sourceConfig)
    const searchQuery = (sourceConfig.searchQuery as string) || ''

    const queryParams = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(PAGE_SIZE),
      timeMin,
      timeMax,
    })

    if (searchQuery.trim()) {
      queryParams.set('q', searchQuery.trim())
    }

    if (cursor) {
      queryParams.set('pageToken', cursor)
    }

    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${queryParams.toString()}`

    logger.info('Listing Google Calendar events', {
      calendarId,
      timeMin,
      timeMax,
      cursor: cursor ?? 'initial',
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list Google Calendar events', {
        status: response.status,
        error: errorText,
      })
      throw new Error(`Failed to list Google Calendar events: ${response.status}`)
    }

    const data = await response.json()
    const events = (data.items || []) as CalendarEvent[]

    const documents: ExternalDocument[] = []
    for (const event of events) {
      const doc = await eventToDocument(event)
      if (doc) documents.push(doc)
    }

    const totalFetched = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched

    const maxEvents = sourceConfig.maxEvents ? Number(sourceConfig.maxEvents) : DEFAULT_MAX_EVENTS
    const hitLimit = maxEvents > 0 && totalFetched >= maxEvents

    const nextPageToken = data.nextPageToken as string | undefined

    return {
      documents,
      nextCursor: hitLimit ? undefined : nextPageToken,
      hasMore: hitLimit ? false : Boolean(nextPageToken),
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const calendarId = ((sourceConfig.calendarId as string) || 'primary').trim()
    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalId)}`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get Google Calendar event: ${response.status}`)
    }

    const event = (await response.json()) as CalendarEvent

    if (event.status === 'cancelled') return null

    return eventToDocument(event)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const maxEvents = sourceConfig.maxEvents as string | undefined
    if (maxEvents && (Number.isNaN(Number(maxEvents)) || Number(maxEvents) <= 0)) {
      return { valid: false, error: 'Max events must be a positive number' }
    }

    try {
      const calendarId = ((sourceConfig.calendarId as string) || 'primary').trim()
      const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?maxResults=1&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(new Date().toISOString())}`

      const response = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        if (response.status === 404) {
          return { valid: false, error: 'Calendar not found. Check the calendar ID.' }
        }
        return { valid: false, error: `Failed to access Google Calendar: ${response.status}` }
      }

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'organizer', displayName: 'Organizer', fieldType: 'text' },
    { id: 'attendeeCount', displayName: 'Attendee Count', fieldType: 'number' },
    { id: 'location', displayName: 'Location', fieldType: 'text' },
    { id: 'eventDate', displayName: 'Event Date', fieldType: 'date' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'createdAt', displayName: 'Created', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.organizer === 'string' && metadata.organizer) {
      result.organizer = metadata.organizer
    }

    if (typeof metadata.attendeeCount === 'number') {
      result.attendeeCount = metadata.attendeeCount
    }

    if (typeof metadata.location === 'string' && metadata.location) {
      result.location = metadata.location
    }

    const eventDate = parseTagDate(metadata.eventDate)
    if (eventDate) result.eventDate = eventDate

    const lastModified = parseTagDate(metadata.updatedTime)
    if (lastModified) result.lastModified = lastModified

    const createdAt = parseTagDate(metadata.createdTime)
    if (createdAt) result.createdAt = createdAt

    return result
  },
}
