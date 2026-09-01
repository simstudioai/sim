/**
 * Base URL for the Circleback public REST API.
 * @see https://circleback.ai/docs/api/openapi.json
 */
export const CIRCLEBACK_API_BASE = 'https://circleback.ai/api'

/**
 * Standard auth headers for every Circleback API call. Circleback authenticates
 * with a bearer API key (`cb_...`).
 */
export function circlebackHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Read an unsuccessful Circleback response and throw a descriptive error.
 *
 * Circleback error bodies carry `error` (human-readable message), an optional
 * machine-readable `code`, and optional field-level `issues`. The raw text is
 * used verbatim when the body is not parseable JSON.
 * Always throws — the `never` return lets callers use it as an expression.
 */
export async function throwCirclebackError(response: Response): Promise<never> {
  const body = await response.text().catch(() => '')
  let detail = body
  try {
    const parsed = JSON.parse(body) as {
      error?: string
      code?: string
      issues?: { message?: string; path?: string }[]
    }
    const issues = (parsed.issues ?? [])
      .map((issue) => [issue.path, issue.message].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('; ')
    detail = [parsed.code, parsed.error, issues].filter(Boolean).join(' - ') || body
  } catch {
    /* Non-JSON body (e.g., a gateway error page) — keep the raw text. */
  }
  const hint =
    response.status === 401
      ? 'Invalid or expired Circleback API key.'
      : response.status === 429
        ? 'Rate limited by Circleback. Retry after a short delay.'
        : null
  const message = [hint, detail].filter(Boolean).join(' ')
  throw new Error(`Circleback API error (${response.status})${message ? `: ${message}` : ''}`)
}

/**
 * Extract the next-page cursor from an RFC 8288 `Link` response header.
 *
 * Circleback list endpoints signal the next page with
 * `Link: <https://circleback.ai/api/...?cursor=abc>; rel="next"`. Returns the
 * `cursor` query parameter of that URL, or null when there is no next page.
 */
export function parseNextCursor(response: Response): string | null {
  const link = response.headers.get('link')
  if (!link) return null
  for (const part of link.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i)
    if (!match) continue
    try {
      /* RFC 8288 allows relative references, so resolve against the API base. */
      return new URL(match[1], CIRCLEBACK_API_BASE).searchParams.get('cursor')
    } catch {
      return null
    }
  }
  return null
}

/**
 * Normalize a list-valued parameter into a string array.
 *
 * Block inputs reach tools as user-typed text, so a list can arrive as a real
 * array, a JSON array string, or a comma-separated string. All three are
 * accepted; blank entries are dropped.
 */
export function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      String(entry)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    )
  }
  if (typeof value === 'number') return [String(value)]
  if (typeof value !== 'string') return []

  const trimmed = value.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.flatMap((entry) =>
          String(entry)
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        )
      }
    } catch {
      /* Fall through to comma-separated parsing. */
    }
  }

  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/**
 * Normalize a list-valued parameter into a numeric-ID array, dropping entries
 * that are not finite integers.
 */
export function toIdList(value: unknown): number[] {
  return toStringList(value)
    .map((entry) => Number(entry))
    .filter((id) => Number.isInteger(id) && id > 0)
}

/**
 * Append repeated query parameters (OpenAPI form/explode style) for each entry
 * of a list-valued filter.
 */
export function appendListParams(url: URL, name: string, values: (string | number)[]): void {
  for (const entry of values) {
    url.searchParams.append(name, String(entry))
  }
}

/** The raw tag object as returned by the Circleback API. */
export interface RawCirclebackTag {
  id?: number
  name?: string
  description?: string | null
}

/** The raw attendee object embedded in Circleback meeting payloads. */
export interface RawCirclebackAttendee {
  profileId?: number
  name?: string | null
  title?: string | null
  companyName?: string | null
  email?: string | null
  isCalendarEventOrganizer?: boolean
  isCalendarInvitee?: boolean
}

/** The raw embedded action item object in Circleback meeting payloads. */
export interface RawCirclebackMeetingActionItem {
  id?: number
  title?: string
  description?: string
  assignee?: {
    profileId?: number
    name?: string | null
    title?: string | null
    companyName?: string | null
    email?: string | null
  } | null
  status?: string
}

/** The raw meeting object as returned by the Circleback API. */
export interface RawCirclebackMeeting {
  id?: string
  name?: string | null
  createdAt?: string
  updatedAt?: string
  duration?: number | null
  url?: string | null
  recordingUrl?: string | null
  tags?: RawCirclebackTag[]
  icalUid?: string | null
  attendees?: RawCirclebackAttendee[]
  notes?: string | null
  privateNotes?: string
  actionItems?: RawCirclebackMeetingActionItem[]
  insights?: Record<string, unknown>
  linkAccess?: string | null
  calendarEvent?: {
    id?: number
    icalUid?: string | null
    description?: string
    platform?: string | null
    platformId?: string | null
  } | null
}

/** Map a raw Circleback tag onto Sim's output shape. */
export function mapTag(raw: RawCirclebackTag) {
  return {
    id: raw.id ?? 0,
    name: raw.name ?? '',
    description: raw.description ?? null,
  }
}

/**
 * Map a raw Circleback meeting onto Sim's output shape. Shared by the get,
 * list, search, update, delete, and tag tools, all of which return meetings.
 */
export function mapMeeting(raw: RawCirclebackMeeting) {
  return {
    id: raw.id ?? '',
    name: raw.name ?? null,
    createdAt: raw.createdAt ?? '',
    updatedAt: raw.updatedAt ?? '',
    duration: raw.duration ?? null,
    url: raw.url ?? null,
    recordingUrl: raw.recordingUrl ?? null,
    tags: (raw.tags ?? []).map(mapTag),
    icalUid: raw.icalUid ?? null,
    attendees: (raw.attendees ?? []).map((attendee) => ({
      profileId: attendee.profileId ?? 0,
      name: attendee.name ?? null,
      title: attendee.title ?? null,
      companyName: attendee.companyName ?? null,
      email: attendee.email ?? null,
      isCalendarEventOrganizer: attendee.isCalendarEventOrganizer ?? false,
      isCalendarInvitee: attendee.isCalendarInvitee ?? false,
    })),
    notes: raw.notes ?? null,
    privateNotes: raw.privateNotes ?? null,
    actionItems: (raw.actionItems ?? []).map((item) => ({
      id: item.id ?? 0,
      title: item.title ?? '',
      description: item.description ?? '',
      assignee: item.assignee
        ? {
            profileId: item.assignee.profileId ?? 0,
            name: item.assignee.name ?? null,
            title: item.assignee.title ?? null,
            companyName: item.assignee.companyName ?? null,
            email: item.assignee.email ?? null,
          }
        : null,
      status: item.status ?? 'PENDING',
    })),
    insights: raw.insights ?? {},
    linkAccess: raw.linkAccess ?? null,
    calendarEvent: raw.calendarEvent ?? null,
  }
}

/** The raw standalone action item object as returned by the Circleback API. */
export interface RawCirclebackActionItem {
  id?: number
  title?: string
  description?: string
  assignee?: {
    profileId?: number
    name?: string | null
    title?: string | null
    companyName?: string | null
    email?: string | null
  } | null
  canEditActionItem?: boolean
  completedAt?: string | null
  meetingId?: string | null
  status?: string
  meetings?: { id?: string; name?: string | null; createdAt?: string }[]
}

/** Map a raw standalone Circleback action item onto Sim's output shape. */
export function mapActionItem(raw: RawCirclebackActionItem) {
  return {
    id: raw.id ?? 0,
    title: raw.title ?? '',
    description: raw.description ?? '',
    assignee: raw.assignee
      ? {
          profileId: raw.assignee.profileId ?? 0,
          name: raw.assignee.name ?? null,
          title: raw.assignee.title ?? null,
          companyName: raw.assignee.companyName ?? null,
          email: raw.assignee.email ?? null,
        }
      : null,
    completedAt: raw.completedAt ?? null,
    meetingId: raw.meetingId ?? null,
    status: raw.status ?? 'PENDING',
    meetings: (raw.meetings ?? []).map((meeting) => ({
      id: meeting.id ?? '',
      name: meeting.name ?? null,
      createdAt: meeting.createdAt ?? '',
    })),
  }
}

/** The raw person object as returned by the Circleback API. */
export interface RawCirclebackPerson {
  id?: number
  title?: string | null
  companyId?: number | null
  companyName?: string | null
  email?: string | null
  firstName?: string | null
  lastName?: string | null
}

/** Map a raw Circleback person onto Sim's output shape. */
export function mapPerson(raw: RawCirclebackPerson) {
  return {
    id: raw.id ?? 0,
    title: raw.title ?? null,
    companyId: raw.companyId ?? null,
    companyName: raw.companyName ?? null,
    email: raw.email ?? null,
    firstName: raw.firstName ?? null,
    lastName: raw.lastName ?? null,
  }
}

/** The raw external link object on Circleback people and companies. */
export interface RawCirclebackExternalLink {
  url?: string
  objectType?: string
  type?: string
}

/** Map raw Circleback external links onto Sim's output shape. */
export function mapExternalLinks(raw: RawCirclebackExternalLink[] | undefined) {
  return (raw ?? []).map((link) => ({
    url: link.url ?? '',
    objectType: link.objectType ?? '',
    type: link.type ?? '',
  }))
}
