import { generateId } from '@sim/utils/id'
import { isRecordLike, toRecord } from '@sim/utils/object'
import type {
  GoogleCalendarApiEventResponse,
  GoogleCalendarEventDetails,
  GoogleCalendarEventRequestBody,
  GoogleCalendarReminderOverride,
} from '@/tools/google_calendar/types'
import type { ToolConfig, ToolOutputProperty } from '@/tools/types'

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

/** Normalize optional attendee emails into `[{ email, optional: true }]`. */
export function normalizeOptionalAttendees(
  attendees: string | string[] | undefined
): Array<{ email: string; optional: true }> {
  return normalizeAttendees(attendees).map(({ email }) => ({ email, optional: true }))
}

const MAX_REMINDER_OVERRIDES = 5
const MAX_REMINDER_MINUTES = 40320

/**
 * Parse the reminders input into the Calendar `reminders` setting. Accepts a JSON string or
 * value that is either an array of `{ method, minutes }` overrides (custom reminders; `[]`
 * turns reminders off) or the API's own `{ useDefault, overrides }` object, so a previous
 * event's reminders can be copied as-is. Returns `undefined` when nothing usable was provided.
 */
function parseReminders(
  reminders: unknown
): { useDefault: boolean; overrides?: GoogleCalendarReminderOverride[] } | undefined {
  if (reminders === undefined || reminders === null) return undefined

  let parsed: unknown = reminders
  if (typeof reminders === 'string') {
    const trimmed = reminders.trim()
    if (!trimmed) return undefined
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('Reminders must be a JSON array like [{"method":"popup","minutes":10}]')
    }
  }

  if (isRecordLike(parsed)) {
    if (typeof parsed.useDefault !== 'boolean') {
      throw new Error('Reminders object needs a boolean useDefault, like {"useDefault":true}')
    }
    if (parsed.useDefault) return { useDefault: true }
    const overrides = parsed.overrides === undefined ? [] : parsed.overrides
    return { useDefault: false, overrides: validateReminderOverrides(overrides) }
  }

  return { useDefault: false, overrides: validateReminderOverrides(parsed) }
}

function validateReminderOverrides(parsed: unknown): GoogleCalendarReminderOverride[] {
  if (!Array.isArray(parsed)) {
    throw new Error('Reminders must be an array of { method, minutes } objects')
  }
  if (parsed.length > MAX_REMINDER_OVERRIDES) {
    throw new Error(`Google Calendar allows at most ${MAX_REMINDER_OVERRIDES} reminders per event`)
  }

  return parsed.map((entry: unknown) => {
    const rec = toRecord(entry)
    const method = rec.method
    const rawMinutes = rec.minutes
    const minutes =
      typeof rawMinutes === 'number'
        ? rawMinutes
        : typeof rawMinutes === 'string' && rawMinutes.trim() !== ''
          ? Number(rawMinutes)
          : Number.NaN
    if (method !== 'email' && method !== 'popup') {
      throw new Error('Each reminder needs a method of "email" or "popup"')
    }
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_REMINDER_MINUTES) {
      throw new Error(`Each reminder needs whole minutes between 0 and ${MAX_REMINDER_MINUTES}`)
    }
    return { method, minutes }
  })
}

interface EventOptionParams {
  visibility?: GoogleCalendarEventRequestBody['visibility']
  transparency?: GoogleCalendarEventRequestBody['transparency']
  colorId?: string
  reminders?: string | GoogleCalendarReminderOverride[]
}

/** Copy the optional visibility, show-as, color, and reminder settings onto an event body. */
export function applyEventOptions(
  body: Partial<GoogleCalendarEventRequestBody>,
  params: EventOptionParams
): void {
  if (params.visibility) body.visibility = params.visibility
  if (params.transparency) body.transparency = params.transparency
  const colorId = params.colorId?.toString().trim()
  if (colorId) body.colorId = colorId
  const reminders = parseReminders(params.reminders)
  if (reminders) body.reminders = reminders
}

/** Fields shared by every event-shaped output beyond the core id/summary/time/people fields. */
export function buildEventDetails(
  event: GoogleCalendarApiEventResponse
): GoogleCalendarEventDetails {
  return {
    hangoutLink: event.hangoutLink ?? null,
    conferenceData: event.conferenceData ?? null,
    recurrence: event.recurrence ?? null,
    recurringEventId: event.recurringEventId ?? null,
    originalStartTime: event.originalStartTime ?? null,
    reminders: event.reminders ?? null,
    visibility: event.visibility ?? null,
    transparency: event.transparency ?? null,
    colorId: event.colorId ?? null,
    eventType: event.eventType ?? null,
    iCalUID: event.iCalUID ?? null,
    created: event.created ?? null,
    updated: event.updated ?? null,
    attachments: event.attachments ?? null,
  }
}

/** Output declarations for {@link buildEventDetails}, spread into each v2 event tool. */
export const EVENT_DETAIL_OUTPUTS: Record<keyof GoogleCalendarEventDetails, ToolOutputProperty> = {
  hangoutLink: { type: 'string', description: 'Google Meet link', optional: true },
  conferenceData: {
    type: 'json',
    description:
      'Conference details: conferenceId, conferenceSolution { name, key.type }, entryPoints [{ entryPointType (video, phone, sip, more), uri, label, pin, meetingCode, passcode }], notes',
    optional: true,
  },
  recurrence: {
    type: 'json',
    description: 'Recurrence rules (RRULE/EXRULE/RDATE/EXDATE)',
    optional: true,
  },
  recurringEventId: {
    type: 'string',
    description: 'For an instance of a recurring event, the ID of the recurring series',
    optional: true,
  },
  originalStartTime: {
    type: 'json',
    description: 'For an instance of a recurring event, its original start time in the series',
    optional: true,
  },
  reminders: {
    type: 'json',
    description: 'Reminders: useDefault and overrides [{ method (email or popup), minutes }]',
    optional: true,
  },
  visibility: {
    type: 'string',
    description: 'Visibility: default, public, private, or confidential',
    optional: true,
  },
  transparency: {
    type: 'string',
    description: 'Show as: opaque (busy) or transparent (free)',
    optional: true,
  },
  colorId: { type: 'string', description: 'Event color ID', optional: true },
  eventType: {
    type: 'string',
    description:
      'Event type: default, outOfOffice, focusTime, workingLocation, fromGmail, or birthday',
    optional: true,
  },
  iCalUID: {
    type: 'string',
    description: 'iCalendar UID (RFC 5545), shared across calendars',
    optional: true,
  },
  created: { type: 'string', description: 'Creation time (RFC3339)', optional: true },
  updated: { type: 'string', description: 'Last modification time (RFC3339)', optional: true },
  attachments: {
    type: 'json',
    description: 'File attachments [{ fileUrl, title, mimeType, iconLink, fileId }]',
    optional: true,
  },
}

/** Optional create/update params for visibility, show-as, color, and reminders. */
export const EVENT_OPTION_PARAMS: ToolConfig['params'] = {
  visibility: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Event visibility: default, public, private, or confidential',
  },
  transparency: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Show as: opaque (busy, the default) or transparent (free)',
  },
  colorId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Event color ID ("1" to "11", from the Calendar colors endpoint)',
  },
  reminders: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Custom reminders replacing the calendar default, as a JSON array of up to 5 { method: "email" | "popup", minutes } objects (e.g., [{"method":"popup","minutes":10}]). Pass [] for no reminders.',
  },
}
