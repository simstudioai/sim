import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { DEFAULT_MAX_EVENTS, googleCalendarConnectorMeta } from '@/connectors/google-calendar/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  computeContentHash,
  htmlToPlainText,
  isListingScopeUnavailableError,
  isPerMemberListing,
  listingRequestError,
  memberDocumentId,
  parseDefaultedUnlimitedSafeInteger,
  parseMultiValue,
  parseTagDate,
  sourceDocumentId,
} from '@/connectors/utils'

const logger = createLogger('GoogleCalendarConnector')

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'
const DEFAULT_RANGE_DAYS = 30
const PAGE_SIZE = 250

class GoogleCalendarCredentialInvalidError extends Error {}

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
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }
    /**
     * `start.timeZone` is a free-form IANA string echoed from the event. An
     * unrecognized or legacy zone makes `toLocaleString` throw a RangeError,
     * which would abort the whole listing page, so fall back to the runtime
     * zone rather than failing the sync over one event.
     */
    if (eventTime.timeZone) {
      try {
        return date.toLocaleString('en-US', { ...options, timeZone: eventTime.timeZone })
      } catch {
        logger.warn('Unrecognized event time zone, formatting in runtime zone', {
          timeZone: eventTime.timeZone,
        })
      }
    }
    return date.toLocaleString('en-US', options)
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
 * Whether attendee/organizer identifiers may be indexed. The dropdown stores the
 * string `'false'` to opt out; anything else — including an unset field on a source
 * configured before the option existed — keeps identifiers.
 */
function readIncludeAttendees(sourceConfig: Record<string, unknown>): boolean {
  const value = sourceConfig.includeAttendees
  return value !== 'false' && value !== false
}

/**
 * Discriminator appended to the metadata-only content hash when attendee
 * identifiers are suppressed. Without it, flipping the toggle would leave every
 * already-synced event hash-unchanged and the setting would never take effect on
 * existing documents. The ON form stays byte-identical to the historical hash so
 * turning the feature on (or leaving it unset) causes zero re-index churn.
 */
const NO_ATTENDEES_HASH_SUFFIX = ':noattendees'

/**
 * Counts attendees excluding rooms/equipment, matching what the content renderer lists.
 */
function countAttendees(attendees?: CalendarAttendee[]): number {
  if (!attendees) return 0
  return attendees.filter((a) => !a.resource).length
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
 *
 * When `includeAttendees` is false the organizer line is dropped entirely and the
 * attendee line degrades to a bare count: a count carries no identity, is already
 * published as the `attendeeCount` tag, and keeps "how big was this meeting"
 * answerable without naming anyone.
 */
function eventToContent(event: CalendarEvent, includeAttendees: boolean): string {
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

  if (includeAttendees) {
    const organizer = formatOrganizer(event.organizer)
    if (organizer) {
      parts.push(`Organizer: ${organizer}`)
    }

    const attendees = formatAttendees(event.attendees)
    if (attendees) {
      parts.push(`Attendees: ${attendees}`)
    }
  } else {
    const attendeeCount = countAttendees(event.attendees)
    if (attendeeCount > 0) {
      parts.push(`Attendees: ${attendeeCount}`)
    }
  }

  if (event.description) {
    parts.push('')
    parts.push('Description:')
    parts.push(htmlToPlainText(event.description))
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
 *
 * Backward compatibility: when only a single calendar is configured (the only
 * code path that existed before multi-calendar support), externalId and
 * contentHash use the legacy non-namespaced format so existing connectors see
 * zero churn on re-sync. When 2+ calendars are configured, we namespace by
 * calendarId because Google Calendar event IDs are only unique within a
 * single calendar.
 */
async function eventToDocument(
  event: CalendarEvent,
  calendarId: string,
  isMultiCalendar: boolean,
  includeAttendees: boolean,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocument | null> {
  if (event.status === 'cancelled') return null

  const content = eventToContent(event, includeAttendees)
  if (!content.trim()) return null

  const startTime = event.start?.dateTime || event.start?.date || ''
  const attendeeCount = countAttendees(event.attendees)

  const memberScoped = isPerMemberListing(syncContext)
  const externalId = memberDocumentId(
    isMultiCalendar || memberScoped ? `${calendarId}:${event.id}` : event.id,
    syncContext
  )
  const baseHash = isMultiCalendar
    ? `gcal:${calendarId}:${event.id}:${event.updated ?? ''}`
    : `gcal:${event.id}:${event.updated ?? ''}`
  const contentHash = includeAttendees ? baseHash : `${baseHash}${NO_ATTENDEES_HASH_SUFFIX}`

  const metadata = {
    calendarId,
    startTime,
    endTime: event.end?.dateTime || event.end?.date || '',
    location: event.location || '',
    organizer: includeAttendees ? formatOrganizer(event.organizer) : '',
    attendeeCount,
    isAllDay: isAllDayEvent(event),
    eventDate: startTime,
    updatedTime: event.updated,
    createdTime: event.created,
  }

  return {
    externalId,
    title: event.summary || 'Untitled Event',
    content,
    mimeType: 'text/plain',
    sourceUrl: event.htmlLink || 'https://calendar.google.com/calendar/',
    /** A reader's visible fields can change with calendar permissions without editing the event. */
    contentHash: memberScoped
      ? `gcal:${externalId}:${await computeContentHash(JSON.stringify({ content, metadata }))}`
      : contentHash,
    metadata,
  }
}

export const googleCalendarConnector: ConnectorConfig = {
  ...googleCalendarConnectorMeta,

  isListingScopeUnavailableError: isListingScopeUnavailableError,
  isCredentialInvalidError: (error) => error instanceof GoogleCalendarCredentialInvalidError,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const parsedCalendarIds = parseMultiValue(sourceConfig.calendarId)
    const calendarIds = parsedCalendarIds.length > 0 ? parsedCalendarIds : ['primary']
    let timeRange = getTimeRange(sourceConfig)
    const searchQuery = (sourceConfig.searchQuery as string) || ''

    /**
     * Cursor format:
     * - For a single calendar with legacy cursors: the raw pageToken string
     * - For multi-calendar walking: JSON-encoded { calendarIndex, pageToken }
     */
    let calendarIndex = 0
    let pageToken: string | undefined

    if (cursor) {
      try {
        const parsed = JSON.parse(cursor) as {
          calendarIndex: number
          pageToken?: string
          timeRange?: { timeMin: string; timeMax: string }
        }
        if (typeof parsed.calendarIndex === 'number') {
          calendarIndex = parsed.calendarIndex
          pageToken = parsed.pageToken
          if (
            parsed.timeRange &&
            typeof parsed.timeRange.timeMin === 'string' &&
            typeof parsed.timeRange.timeMax === 'string' &&
            Date.parse(parsed.timeRange.timeMin) < Date.parse(parsed.timeRange.timeMax)
          ) {
            timeRange = parsed.timeRange
          }
        } else {
          pageToken = cursor
        }
      } catch {
        pageToken = cursor
      }
    }

    if (calendarIndex >= calendarIds.length) {
      return { documents: [], hasMore: false }
    }

    const calendarId = calendarIds[calendarIndex]
    const { timeMin, timeMax } = timeRange

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    const maxEvents = parseDefaultedUnlimitedSafeInteger(
      sourceConfig.maxEvents,
      DEFAULT_MAX_EVENTS,
      'Max events must be a non-negative whole number'
    )
    const isCapped = maxEvents > 0
    /**
     * Last-page precision: never ask Google for more events than the remaining
     * cap allowance. `maxResults` is capped at 2500 by the API; PAGE_SIZE stays
     * within that.
     */
    const pageSize = isCapped
      ? Math.max(1, Math.min(PAGE_SIZE, maxEvents - prevFetched))
      : PAGE_SIZE

    const queryParams = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(pageSize),
      timeMin,
      timeMax,
    })

    if (searchQuery.trim()) {
      queryParams.set('q', searchQuery.trim())
    }

    if (pageToken) {
      queryParams.set('pageToken', pageToken)
    }

    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${queryParams.toString()}`

    logger.info('Listing Google Calendar events', {
      calendarId,
      calendarIndex,
      calendarCount: calendarIds.length,
      timeMin,
      timeMax,
      hasPageToken: Boolean(pageToken),
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        throw new GoogleCalendarCredentialInvalidError('Reconnect your Google Calendar account')
      }
      const errorText = await response.text()
      logger.error('Failed to list Google Calendar events', {
        status: response.status,
        calendarId,
        error: errorText,
      })
      const error = listingRequestError('Failed to list Google Calendar events', response.status)
      /**
       * One of several calendars a member cannot reach is absent from their
       * listing, not the end of it: move on to the next calendar so the rest of
       * their access survives. A sole unreachable calendar is the whole scope,
       * which the members-mode crawl reads as a complete listing of nothing, and
       * a shared credential still fails the sync rather than silently dropping
       * the calendar's events.
       */
      if (
        isListingScopeUnavailableError(error) &&
        calendarIds.length > 1 &&
        isPerMemberListing(syncContext)
      ) {
        logger.warn('Skipping a Google Calendar the member cannot reach', {
          calendarId,
          status: response.status,
        })
        return calendarIndex + 1 < calendarIds.length
          ? {
              documents: [],
              nextCursor: JSON.stringify({ calendarIndex: calendarIndex + 1, timeRange }),
              hasMore: true,
            }
          : { documents: [], hasMore: false }
      }
      throw error
    }

    const data = await response.json()
    const events = (data.items || []) as CalendarEvent[]

    const isMultiCalendar = calendarIds.length > 1
    const includeAttendees = readIncludeAttendees(sourceConfig)
    const allDocuments: ExternalDocument[] = []
    for (const event of events) {
      const doc = await eventToDocument(
        event,
        calendarId,
        isMultiCalendar,
        includeAttendees,
        syncContext
      )
      if (doc) allDocuments.push(doc)
    }

    let documents = allDocuments
    if (isCapped) {
      const remaining = Math.max(0, maxEvents - prevFetched)
      if (allDocuments.length > remaining) documents = allDocuments.slice(0, remaining)
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched

    const nextPageToken = (data.nextPageToken as string | undefined) || undefined
    const hasMoreCalendars = calendarIndex + 1 < calendarIds.length
    const hitLimit = isCapped && totalFetched >= maxEvents

    /**
     * `listingCapped` suppresses the sync engine's deletion reconciliation, so
     * it is set only when the `maxEvents` cap actually truncated a larger
     * source — events were dropped from this page, another page remains, or a
     * configured calendar is still unwalked. A cap reached exactly at source
     * exhaustion leaves it unset so events deleted upstream still reconcile.
     * The `timeMin`/`timeMax` window is an intentional scope filter, never a
     * cap, and is deliberately not flagged.
     */
    const truncatedByCap =
      hitLimit &&
      (documents.length < allDocuments.length || Boolean(nextPageToken) || hasMoreCalendars)
    if (truncatedByCap && syncContext) syncContext.listingCapped = true

    if (hitLimit) {
      return { documents, hasMore: false }
    }

    if (nextPageToken) {
      return {
        documents,
        nextCursor: JSON.stringify({ calendarIndex, pageToken: nextPageToken, timeRange }),
        hasMore: true,
      }
    }

    if (hasMoreCalendars) {
      return {
        documents,
        nextCursor: JSON.stringify({ calendarIndex: calendarIndex + 1, timeRange }),
        hasMore: true,
      }
    }

    return { documents, hasMore: false }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const sourceId = sourceDocumentId(externalId, syncContext)
    if (!sourceId) return null
    /**
     * externalId format depends on connector configuration:
     * - Single-calendar (1 calendar configured): externalId = eventId (legacy
     *   and current single-calendar format).
     * - Multi-calendar (2+ calendars configured): externalId =
     *   `calendarId:eventId`. The first `:` is the separator — event IDs never
     *   contain `:` while calendar IDs (e.g. `user@group.calendar.google.com`)
     *   may include URL-safe chars but not `:`.
     *
     * Legacy in-flight rows that lack a separator fall back to the configured
     * calendar (or `primary`).
     */
    const parsedCalendarIds = parseMultiValue(sourceConfig.calendarId)
    const calendarIds = parsedCalendarIds.length > 0 ? parsedCalendarIds : ['primary']

    /**
     * Derive `isMultiCalendar` from the externalId itself, not from the current
     * config. If a row was synced under a multi-calendar config and the user
     * later removed calendars, the row's externalId still has the prefix —
     * returning a doc without the prefix would mint a duplicate via the sync
     * engine's externalId-keyed matching.
     */
    const separatorIndex = sourceId.lastIndexOf(':')
    const isMultiCalendar = separatorIndex !== -1
    let calendarId: string
    let eventId: string
    if (separatorIndex === -1) {
      calendarId = calendarIds[0] ?? 'primary'
      eventId = sourceId
    } else {
      calendarId = sourceId.slice(0, separatorIndex)
      eventId = sourceId.slice(separatorIndex + 1)
    }
    if (isPerMemberListing(syncContext) && !calendarIds.includes(calendarId)) return null

    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 404 || response.status === 410) return null
      if (response.status === 401) {
        throw new GoogleCalendarCredentialInvalidError('Reconnect your Google Calendar account')
      }
      throw new Error(`Failed to get Google Calendar event: ${response.status}`)
    }

    const event = (await response.json()) as CalendarEvent

    if (event.status === 'cancelled') return null

    return eventToDocument(
      event,
      calendarId,
      isMultiCalendar,
      readIncludeAttendees(sourceConfig),
      syncContext
    )
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    syncContext?: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const parsedCalendarIds = parseMultiValue(sourceConfig.calendarId)
    const calendarIds = parsedCalendarIds.length > 0 ? parsedCalendarIds : ['primary']

    try {
      const maxEvents = parseDefaultedUnlimitedSafeInteger(
        sourceConfig.maxEvents,
        DEFAULT_MAX_EVENTS,
        'Max events must be a positive whole number'
      )
      if (maxEvents === 0 && !(isPerMemberListing(syncContext) && sourceConfig.maxEvents === 0)) {
        return { valid: false, error: 'Max events must be a positive whole number' }
      }
      for (const calendarId of calendarIds) {
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
            return {
              valid: false,
              error: `Calendar not found: ${calendarId}. Check the calendar ID.`,
            }
          }
          return {
            valid: false,
            error: `Failed to access Google Calendar "${calendarId}": ${response.status}`,
          }
        }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

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
