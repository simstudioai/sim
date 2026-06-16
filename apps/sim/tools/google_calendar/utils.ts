import { generateId } from '@sim/utils/id'
import type { GoogleCalendarEventRequestBody } from '@/tools/google_calendar/types'

type EventDateTime = GoogleCalendarEventRequestBody['start']

const DEFAULT_TIME_ZONE = 'America/Los_Angeles'
const TZ_OFFSET_PATTERN = /([+-]\d{2}:?\d{2}|Z)$/

/**
 * Build a Google Calendar event date/time object from a user-supplied value.
 *
 * A date-only value (e.g. `2025-06-03`) produces an all-day `{ date }` object.
 * A datetime value produces `{ dateTime, timeZone? }`. A timezone is attached when
 * one is explicitly provided, when the datetime carries no UTC offset (so the time
 * is unambiguous), or when `requireTimeZone` is set — the Calendar API requires a
 * timezone on the start/end of recurring events.
 */
export function buildEventDateTime(
  value: string,
  timeZone: string | undefined,
  requireTimeZone = false
): EventDateTime {
  const isDateOnly = !value.includes('T')
  if (isDateOnly) {
    return { date: value }
  }

  const hasOffset = TZ_OFFSET_PATTERN.test(value)
  const result: EventDateTime = { dateTime: value }
  if (timeZone) {
    result.timeZone = timeZone
  } else if (!hasOffset || requireTimeZone) {
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
