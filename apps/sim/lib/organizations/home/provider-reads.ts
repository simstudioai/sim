import { toArray, toRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { hasRateLimitEvidence } from '@/lib/knowledge/documents/utils'
import {
  HOME_CALENDAR_ATTENDEE_LIMIT,
  HOME_CALENDAR_EVENT_LIMIT,
  HOME_EMAIL_THREAD_LIMIT,
  HOME_TEXT_LIMITS,
} from '@/lib/organizations/home/limits'
import { gmailGetThreadV2Tool } from '@/tools/gmail/get_thread'
import { gmailListThreadsV2Tool } from '@/tools/gmail/list_threads'
import { listV2Tool as googleCalendarListTool } from '@/tools/google_calendar/list'
import { outlookCalendarListEventsTool } from '@/tools/outlook/calendar_list_events'
import { flattenGraphEvent } from '@/tools/outlook/calendar-utils'
import { outlookReadTool } from '@/tools/outlook/read'
import type { CleanedOutlookEvent, GraphEvent } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

const REQUEST_TIMEOUT_MS = 10_000
const RESPONSE_MAX_BYTES = 4 * 1024 * 1024
const GMAIL_THREAD_CONCURRENCY = 5
/** The Outlook read tool's own ceiling for a folder listing. */
const OUTLOOK_MESSAGE_LIMIT = 10
/** Asks only for what a widget shows, so no mail or event body is ever fetched. */
const GMAIL_THREAD_FIELDS = [
  ['metadataHeaders', 'From'],
  ['metadataHeaders', 'Subject'],
  ['metadataHeaders', 'Date'],
] as const
const OUTLOOK_MESSAGE_FIELDS = [
  ['$select', 'id,subject,bodyPreview,from,sender,receivedDateTime'],
] as const
const OUTLOOK_EVENT_FIELDS = [
  ['$select', 'id,subject,start,end,isAllDay,isCancelled,attendees,webLink'],
] as const
const UNKNOWN_SENDER = 'Unknown sender'
const NO_SUBJECT = '(No subject)'

export type HomeProviderFailure =
  /** The provider rejected this access token; a refreshed one may still work. */
  | 'token_rejected'
  /** The provider refuses this grant until the member connects again. */
  | 'needs_reauth'
  | 'unavailable'

/** Carries a classification only: a provider's response text never leaves this module. */
export class HomeProviderReadError extends Error {
  constructor(
    readonly failure: HomeProviderFailure,
    readonly httpStatus?: number
  ) {
    super(`Home provider read failed: ${failure}`)
    this.name = 'HomeProviderReadError'
  }
}

export interface HomeEmailThread {
  id: string
  sender: string
  subject: string
  excerpt: string
  receivedAt: string
  messageCount?: number
  url: string
}

export interface HomeCalendarEvent {
  id: string
  title: string
  allDay: boolean
  startAt: string
  endAt: string
  url?: string
  people: { name: string }[]
}

export interface HomeCalendarWindow {
  startAt: string
  endAt: string
}

interface ProviderReadInput {
  accessToken: string
  signal: AbortSignal
}

/**
 * Sends a tool's own request under the widget's bounds. The tool's URL and headers are reused, with
 * the `narrowing` parameters added; what differs from a workflow run is that nothing follows a
 * redirect with the token, and a response past the byte limit fails rather than filling memory.
 */
async function requestTool<P>(
  tool: Pick<ToolConfig<P, unknown>, 'request'>,
  params: P,
  signal: AbortSignal,
  narrowing: readonly (readonly [string, string])[] = []
) {
  const { url, headers } = tool.request
  const target = new URL(typeof url === 'function' ? url(params) : url)
  for (const [name, value] of narrowing) target.searchParams.append(name, value)
  const response = await secureFetchWithValidation(target.toString(), {
    profile: 'configuredEndpoint',
    method: 'GET',
    headers: headers(params),
    signal,
    timeout: REQUEST_TIMEOUT_MS,
    maxResponseBytes: RESPONSE_MAX_BYTES,
    maxRedirects: 0,
    acceptCompressed: true,
  })
  if (response.ok) return response
  await response.text().catch(() => '')
  if (response.status === 401) throw new HomeProviderReadError('token_rejected', 401)
  if (response.status === 403 && !hasRateLimitEvidence(response.headers))
    throw new HomeProviderReadError('needs_reauth', 403)
  throw new HomeProviderReadError('unavailable', response.status)
}

async function runTool<P, R>(
  tool: ToolConfig<P, R>,
  params: P,
  signal: AbortSignal,
  narrowing?: readonly (readonly [string, string])[]
): Promise<R> {
  const response = await requestTool(tool, params, signal, narrowing)
  if (!tool.transformResponse) throw new HomeProviderReadError('unavailable')
  return tool.transformResponse(
    new Response(await response.arrayBuffer(), { status: response.status }),
    params,
    { signal }
  )
}

const ELLIPSIS = '...'

function bounded(value: string | null | undefined, limit: number) {
  return truncate((value ?? '').trim(), limit - ELLIPSIS.length, ELLIPSIS)
}

/** The display name from an RFC 5322 mailbox: `Ada Lovelace <ada@example.com>` reads as Ada. */
function senderName(from: string | null | undefined) {
  const mailbox = (from ?? '').trim()
  const named = /^"?([^"<]+?)"?\s*<[^>]*>$/.exec(mailbox)?.[1]?.trim()
  return bounded(named || mailbox.replace(/^<|>$/g, ''), HOME_TEXT_LIMITS.name)
}

function isoOrNull(value: string | null | undefined) {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

/** Latest inbox threads. */
export async function readGmailThreads({
  accessToken,
  signal,
}: ProviderReadInput): Promise<HomeEmailThread[]> {
  const list = await runTool(
    gmailListThreadsV2Tool,
    { accessToken, labelIds: 'INBOX', maxResults: HOME_EMAIL_THREAD_LIMIT },
    signal
  )
  if (!list.success) throw new HomeProviderReadError('unavailable')
  const threads = await mapWithConcurrency(
    list.output.threads.slice(0, HOME_EMAIL_THREAD_LIMIT),
    GMAIL_THREAD_CONCURRENCY,
    async ({ id }) => {
      const thread = await runTool(
        gmailGetThreadV2Tool,
        { accessToken, threadId: id, format: 'metadata' },
        signal,
        GMAIL_THREAD_FIELDS
      )
      if (!thread.success) throw new HomeProviderReadError('unavailable')
      const messages = thread.output.messages
      const latest = messages[messages.length - 1]
      const receivedAt = isoOrNull(latest?.date)
      if (!latest || !receivedAt) return null
      return {
        id,
        sender: senderName(latest.from) || UNKNOWN_SENDER,
        subject: bounded(latest.subject, HOME_TEXT_LIMITS.title) || NO_SUBJECT,
        excerpt: bounded(latest.snippet, HOME_TEXT_LIMITS.excerpt),
        receivedAt,
        ...(messages.length > 1 ? { messageCount: messages.length } : {}),
        url: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(id)}`,
      }
    }
  )
  return threads.filter((thread) => thread !== null)
}

/** Latest messages in the Outlook inbox. Graph does not group these into threads here. */
export async function readOutlookMessages({
  accessToken,
  signal,
}: ProviderReadInput): Promise<HomeEmailThread[]> {
  const { output } = await runTool(
    outlookReadTool,
    { accessToken, folder: 'inbox', maxResults: OUTLOOK_MESSAGE_LIMIT },
    signal,
    OUTLOOK_MESSAGE_FIELDS
  )
  return output.results.flatMap((message) => {
    const receivedAt = isoOrNull(message.receivedDateTime)
    if (!receivedAt) return []
    return [
      {
        id: message.id,
        sender:
          bounded(
            message.from?.name || message.from?.address || message.sender?.name,
            HOME_TEXT_LIMITS.name
          ) || UNKNOWN_SENDER,
        subject: bounded(message.subject, HOME_TEXT_LIMITS.title) || NO_SUBJECT,
        excerpt: bounded(message.bodyPreview, HOME_TEXT_LIMITS.excerpt),
        receivedAt,
        url: `https://outlook.office.com/mail/inbox/id/${encodeURIComponent(message.id)}`,
      },
    ]
  })
}

function httpsUrl(value: string | null | undefined) {
  return value?.startsWith('https://') && value.length <= 2048 && URL.canParse(value)
    ? value
    : undefined
}

function attendees(people: readonly (string | null | undefined)[]) {
  return people
    .flatMap((name) => (name?.trim() ? [{ name: bounded(name, HOME_TEXT_LIMITS.name) }] : []))
    .slice(0, HOME_CALENDAR_ATTENDEE_LIMIT)
}

interface CalendarReadInput extends ProviderReadInput {
  window: HomeCalendarWindow
}

/** One day of the member's primary Google calendar, with recurring events expanded. */
export async function readGoogleCalendarDay({
  accessToken,
  signal,
  window,
}: CalendarReadInput): Promise<HomeCalendarEvent[]> {
  const { output } = await runTool(
    googleCalendarListTool,
    {
      accessToken,
      calendarId: 'primary',
      timeMin: window.startAt,
      timeMax: window.endAt,
      maxResults: HOME_CALENDAR_EVENT_LIMIT,
      orderBy: 'startTime',
    },
    signal
  )
  return output.events.flatMap((event) => {
    if (event.status === 'cancelled') return []
    const allDay = Boolean(event.start.date)
    const startAt = allDay ? window.startAt : isoOrNull(event.start.dateTime)
    const endAt = allDay ? window.endAt : isoOrNull(event.end.dateTime)
    if (!startAt || !endAt) return []
    return [
      {
        id: event.id,
        title: bounded(event.summary, HOME_TEXT_LIMITS.title) || 'Untitled event',
        allDay,
        startAt,
        endAt,
        url: httpsUrl(event.htmlLink),
        people: attendees(
          (event.attendees ?? []).map((person) => person.displayName || person.email)
        ),
      },
    ]
  })
}

/** Graph answers in UTC unless asked otherwise, and no other zone is ever requested here. */
function graphInstant(value: CleanedOutlookEvent['start']) {
  return value?.timeZone === 'UTC' && value.dateTime ? isoOrNull(`${value.dateTime}Z`) : null
}

/** One day of the mailbox's default Outlook calendar, with cancelled occurrences removed. */
export async function readOutlookCalendarDay({
  accessToken,
  signal,
  window,
}: CalendarReadInput): Promise<HomeCalendarEvent[]> {
  const response = await requestTool(
    outlookCalendarListEventsTool,
    {
      accessToken,
      startDateTime: window.startAt,
      endDateTime: window.endAt,
      maxResults: HOME_CALENDAR_EVENT_LIMIT,
    },
    signal,
    OUTLOOK_EVENT_FIELDS
  )
  const rows = toArray<GraphEvent & { isCancelled?: boolean }>(
    toRecord(await response.json()).value
  )
  return rows.flatMap((row) => {
    if (row.isCancelled) return []
    const event = flattenGraphEvent(row)
    const allDay = event.isAllDay === true
    const startAt = allDay ? window.startAt : graphInstant(event.start)
    const endAt = allDay ? window.endAt : graphInstant(event.end)
    if (!startAt || !endAt) return []
    return [
      {
        id: event.id,
        title: bounded(event.subject, HOME_TEXT_LIMITS.title) || 'Untitled event',
        allDay,
        startAt,
        endAt,
        url: httpsUrl(event.webLink),
        people: attendees(event.attendees.map((person) => person.name || person.address)),
      },
    ]
  })
}
