import type {
  CleanedOutlookEvent,
  CleanedOutlookEventAttendee,
  GraphAttendee,
  GraphDateTimeTimeZone,
  GraphEvent,
} from '@/tools/outlook/types'
import type { ToolRetryConfig } from '@/tools/types'

/**
 * Shared retry config for the Outlook calendar tools.
 *
 * Microsoft Graph throttles a single mailbox at roughly four concurrent requests and
 * returns 429 with a `Retry-After` header when calendar operations fan out (e.g. many
 * parallel event creates in a workflow). The tool executor retries 429/5xx with backoff
 * and honors `Retry-After`. `retryIdempotentOnly` is `false` so create/update/respond
 * (POST/PATCH) also retry — a 429 is a pre-processing throttle, so retrying does not
 * duplicate the event.
 */
export const CALENDAR_RETRY: ToolRetryConfig = {
  enabled: true,
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 30000,
  retryIdempotentOnly: false,
}

/** Matches a trailing UTC offset (`Z`, `+02:00`, `-0800`) on an ISO datetime string. */
const TZ_OFFSET_PATTERN = /([+-]\d{2}:?\d{2}|Z)$/

/** Matches the milliseconds + `Z` suffix produced by `Date.toISOString()`. */
const ISO_MS_ZULU_PATTERN = /\.\d{3}Z$/

/** Time zone recorded when the caller supplies none and the datetime carries no offset. */
export const DEFAULT_OUTLOOK_TIME_ZONE = 'UTC'

/** Attendee category understood by Microsoft Graph. */
export type GraphAttendeeType = 'required' | 'optional' | 'resource'

/** Attendee payload shape Microsoft Graph expects on event create/update. */
export interface GraphAttendeeInput {
  emailAddress: { address: string }
  type: GraphAttendeeType
}

/**
 * Build a Microsoft Graph `{ dateTime, timeZone }` value from a user-supplied datetime.
 *
 * Graph expects an offset-less `dateTime` paired with a named `timeZone`, unlike Google
 * Calendar which accepts the offset inside the string. Behavior:
 * - Date-only input (`2025-06-03`) is pinned to midnight for an all-day event.
 * - An input carrying a UTC offset (`...Z` or `+02:00`) is converted to the equivalent UTC
 *   instant so Graph interprets it unambiguously.
 * - A naive datetime is treated as wall-clock time in the provided (or default) zone.
 */
export function buildGraphEventDateTime(value: string, timeZone?: string): GraphDateTimeTimeZone {
  const trimmed = value.trim()

  if (!trimmed.includes('T')) {
    return { dateTime: `${trimmed}T00:00:00`, timeZone: timeZone || DEFAULT_OUTLOOK_TIME_ZONE }
  }

  const offsetMatch = trimmed.match(TZ_OFFSET_PATTERN)
  if (offsetMatch) {
    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime())) {
      return { dateTime: parsed.toISOString().replace(ISO_MS_ZULU_PATTERN, ''), timeZone: 'UTC' }
    }
    // Unparseable offset: strip it and fall back to the caller's zone.
    return {
      dateTime: trimmed.slice(0, trimmed.length - offsetMatch[0].length),
      timeZone: timeZone || DEFAULT_OUTLOOK_TIME_ZONE,
    }
  }

  return { dateTime: trimmed, timeZone: timeZone || DEFAULT_OUTLOOK_TIME_ZONE }
}

/** Extract the `YYYY-MM-DD` date portion from a date or datetime string. */
function toDateOnly(value: string): string {
  const trimmed = value.trim()
  const tIndex = trimmed.indexOf('T')
  return tIndex === -1 ? trimmed : trimmed.slice(0, tIndex)
}

/** Add one calendar day to a `YYYY-MM-DD` string. */
function nextDay(dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Build the Graph `start`/`end` pair for an all-day event.
 *
 * Graph requires all-day events to have midnight `dateTime` values and an **exclusive**
 * end day strictly after the start day. Callers routinely pass the same date (or timed
 * placeholders) for both bounds, which Graph rejects with a 400. This normalizes both
 * bounds to midnight and advances the end to at least the day after the start.
 */
export function buildAllDayRange(
  startInput: string,
  endInput: string,
  timeZone?: string
): { start: GraphDateTimeTimeZone; end: GraphDateTimeTimeZone } {
  const tz = timeZone || DEFAULT_OUTLOOK_TIME_ZONE
  const startDate = toDateOnly(startInput)
  let endDate = toDateOnly(endInput)
  // `YYYY-MM-DD` strings compare correctly lexicographically.
  if (endDate <= startDate) {
    endDate = nextDay(startDate)
  }
  return {
    start: { dateTime: `${startDate}T00:00:00`, timeZone: tz },
    end: { dateTime: `${endDate}T00:00:00`, timeZone: tz },
  }
}

/**
 * Normalize a comma/newline-separated string (or array) of email addresses into the Graph
 * attendee payload shape.
 */
export function normalizeAttendees(
  attendees: string | string[] | undefined,
  type: GraphAttendeeType = 'required'
): GraphAttendeeInput[] {
  if (!attendees) return []

  const list = Array.isArray(attendees) ? attendees : String(attendees).split(/[,\n]/)

  return list
    .map((address) => address.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address }, type }))
}

/** Flatten a raw Graph attendee into our cleaned attendee shape. */
function flattenGraphAttendee(attendee: GraphAttendee): CleanedOutlookEventAttendee {
  return {
    name: attendee.emailAddress?.name,
    address: attendee.emailAddress?.address,
    type: attendee.type,
    response: attendee.status?.response,
  }
}

/**
 * Flatten a raw Microsoft Graph event into the cleaned, editor-friendly event shape our
 * tools return: `id, subject, start, end, organizer, attendees, isAllDay, onlineMeeting,
 * webLink, bodyPreview`.
 */
export function flattenGraphEvent(event: GraphEvent): CleanedOutlookEvent {
  return {
    id: event.id,
    subject: event.subject,
    bodyPreview: event.bodyPreview,
    start: event.start
      ? { dateTime: event.start.dateTime, timeZone: event.start.timeZone }
      : undefined,
    end: event.end ? { dateTime: event.end.dateTime, timeZone: event.end.timeZone } : undefined,
    isAllDay: event.isAllDay,
    location: event.location?.displayName,
    organizer: event.organizer?.emailAddress
      ? {
          name: event.organizer.emailAddress.name,
          address: event.organizer.emailAddress.address,
        }
      : undefined,
    attendees: (event.attendees ?? []).map(flattenGraphAttendee),
    onlineMeeting: event.onlineMeeting?.joinUrl ? { joinUrl: event.onlineMeeting.joinUrl } : null,
    webLink: event.webLink,
  }
}
