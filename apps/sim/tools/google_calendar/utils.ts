import { generateId } from '@sim/utils/id'
import type { GoogleCalendarEventRequestBody } from '@/tools/google_calendar/types'

type EventDateTime = GoogleCalendarEventRequestBody['start']

const DEFAULT_TIME_ZONE = 'America/Los_Angeles'
const TZ_OFFSET_PATTERN = /([+-]\d{2}:?\d{2}|Z)$/

/**
 * Build a Google Calendar event date/time object from a user-supplied value.
 *
 * A date-only value (e.g. `2025-06-03`) produces an all-day `{ date }` object.
 * A datetime value produces `{ dateTime, timeZone? }`. An explicitly provided
 * timezone always wins. Otherwise a default zone is attached only for "naive"
 * datetimes that carry no UTC offset — when an offset is present it is authoritative
 * and is never overridden with a guessed zone, which would misalign the time.
 *
 * For recurring events the Calendar API requires a named `timeZone` on start/end;
 * callers should pass the user's timezone explicitly (an RFC3339 offset alone is
 * insufficient to expand a recurrence across DST).
 */
export function buildEventDateTime(value: string, timeZone: string | undefined): EventDateTime {
  const isDateOnly = !value.includes('T')
  if (isDateOnly) {
    return { date: value }
  }

  const hasOffset = TZ_OFFSET_PATTERN.test(value)
  const result: EventDateTime = { dateTime: value }
  if (timeZone) {
    result.timeZone = timeZone
  } else if (!hasOffset) {
    result.timeZone = DEFAULT_TIME_ZONE
  }
  return result
}

/** Normalize a comma/newline-separated string or array of attendee emails into `[{ email }]`. */
export function normalizeAttendees(
  attendees: string | string[] | undefined
): Array<{ email: string }> {
  if (!attendees) return []

  const list = Array.isArray(attendees)
    ? attendees
    : attendees.split(',').map((email) => email.trim())

  return list.filter((email) => email.length > 0).map((email) => ({ email }))
}

/**
 * Recurring events require a named `timeZone` on their timed start/end — the Calendar API
 * rejects them otherwise, and an RFC3339 offset is not a substitute (an IANA zone cannot be
 * derived from a fixed offset). Throws a clear error so we fail fast with guidance instead of
 * silently guessing a zone (which would misalign the recurrence) or sending an invalid request.
 * All-day recurring events (date-only values) do not need a timezone and are allowed.
 */
export function assertRecurringTimeZone(
  dateTimes: Array<string | undefined>,
  timeZone: string | undefined
): void {
  if (timeZone) return
  const hasTimedValue = dateTimes.some((value) => value?.includes('T'))
  if (hasTimedValue) {
    throw new Error(
      'Recurring events require a time zone. Provide the timeZone parameter (an IANA name, e.g. America/New_York).'
    )
  }
}

/** Normalize recurrence rules (single string, newline-separated string, or array) into an array. */
export function normalizeRecurrence(recurrence: string | string[] | undefined): string[] {
  if (!recurrence) return []

  const list = Array.isArray(recurrence) ? recurrence : recurrence.split('\n')

  return list.map((rule) => rule.trim()).filter((rule) => rule.length > 0)
}

/** Build a `conferenceData.createRequest` payload that asks Google to attach a Meet link. */
export function buildGoogleMeetConferenceData(): GoogleCalendarEventRequestBody['conferenceData'] {
  return {
    createRequest: {
      requestId: generateId(),
      conferenceSolutionKey: { type: 'hangoutsMeet' },
    },
  }
}
