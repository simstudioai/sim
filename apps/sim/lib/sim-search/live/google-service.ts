import { normalizeEmail } from '@sim/utils/string'
import { zonedWallClockToUtc } from '@/lib/core/utils/timezone'
import type { ConnectorAccessToken } from '@/lib/knowledge/connectors/access-token'
import {
  array,
  createNativeClient,
  NativeSearchError,
  object,
  segment,
  string,
} from '@/lib/sim-search/live/http'
import { createPolicyVerifier } from '@/lib/sim-search/live/policy'
import type { LiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import type { NativeClient, NativeDocument, NativeSearchInput } from '@/lib/sim-search/live/types'
import {
  getGoogleWorkspaceUser,
  selectedGoogleWorkspaceUsers,
} from '@/connectors/google-workspace/users'

type GoogleProvider = 'google_drive' | 'gmail' | 'google_calendar'
type Reference = Pick<NativeDocument, 'id' | 'container' | 'kind'>
const SOURCE_REQUEST_BUDGET = 30
const DAY_MS = 86400000

interface GoogleServiceSession {
  verify(document: Reference): Promise<boolean>
  partial: boolean
  scopeSearch(input: NativeSearchInput): NativeSearchInput | null
}

function calendarSourceWindow(config: Record<string, unknown>, now: number) {
  const range = string(config.dateRange) || 'default'
  const past = range === 'future_only' ? 0 : range === 'past_90' ? 90 : 30
  const future = range === 'past_only' ? 0 : range === 'past_90' ? 90 : 30
  return { start: now - past * DAY_MS, end: now + future * DAY_MS }
}

/** Delegation is bound to a provider-proven identity and the source's current Workspace customer. */
export async function createGoogleServiceVerifier(input: {
  provider: GoogleProvider
  token: ConnectorAccessToken
  member: NativeClient
  config: Record<string, unknown>
  policy: LiveSearchPolicy
  signal: AbortSignal
}): Promise<GoogleServiceSession> {
  const { provider, token, member, config, policy, signal } = input
  if (!token.getDelegatedAccessToken)
    throw new NativeSearchError(
      'unavailable',
      'Configure a Google Workspace service account with domain-wide delegation.'
    )
  const identity = object(
    await member.json(
      provider === 'gmail'
        ? '/gmail/v1/users/me/profile'
        : provider === 'google_drive'
          ? '/drive/v3/about'
          : '/calendar/v3/calendars/primary',
      provider === 'google_drive' ? { query: { fields: 'user(emailAddress)' } } : undefined
    )
  )
  const email = normalizeEmail(
    string(
      provider === 'google_drive'
        ? object(identity.user).emailAddress
        : provider === 'gmail'
          ? identity.emailAddress
          : identity.id
    )
  )
  if (!email)
    throw new NativeSearchError(
      'reconnect',
      'The connected Google account identity could not be verified.'
    )
  const administrator = await getGoogleWorkspaceUser(token.accessToken, string(config.adminEmail), {
    signal,
  })
  if (!administrator?.active)
    throw new NativeSearchError('unavailable', 'The source Directory administrator is unavailable.')
  const selected = selectedGoogleWorkspaceUsers(config.userEmails)
  const subjects = provider === 'google_drive' && selected.length ? selected : [email]
  if (provider !== 'google_drive' && selected.length && !selected.includes(email)) {
    return { verify: async () => false, partial: false, scopeSearch: () => null }
  }
  const clients: {
    email: string
    client: NativeClient
    verifyPolicy: ReturnType<typeof createPolicyVerifier>
  }[] = []
  for (const subject of subjects.slice(0, 6)) {
    signal.throwIfAborted()
    const person = await getGoogleWorkspaceUser(token.accessToken, subject, { signal })
    if (
      !person?.active ||
      person.customerId !== administrator.customerId ||
      person.email !== subject
    )
      continue
    const accessToken = await token.getDelegatedAccessToken(person.email, signal)
    const client = createNativeClient({ origin: 'https://www.googleapis.com', accessToken, signal })
    clients.push({
      email: person.email,
      client,
      verifyPolicy: createPolicyVerifier(provider, policy, client, 'https://www.googleapis.com'),
    })
  }
  let partial = subjects.length > 6
  if (provider === 'google_drive' && !selected.length && !clients.length) {
    signal.throwIfAborted()
    const accessToken = await token.getDelegatedAccessToken(administrator.email, signal)
    const client = createNativeClient({ origin: 'https://www.googleapis.com', accessToken, signal })
    clients.push({
      email: administrator.email,
      client,
      verifyPolicy: createPolicyVerifier(provider, policy, client, 'https://www.googleapis.com'),
    })
    partial = true
  }
  const calendarTimeZones = new Map<string, Promise<string>>()
  const calendarWindow = calendarSourceWindow(config, Date.now())
  /** An events.list response carries the calendar's time zone under the crawl's events-only scope. */
  const calendarTimeZone = (subject: string, calendarId: string, client: NativeClient) => {
    const key = JSON.stringify([subject, calendarId])
    let pending = calendarTimeZones.get(key)
    if (!pending) {
      pending = client
        .json(`/calendar/v3/calendars/${segment(calendarId)}/events`, {
          query: { maxResults: '1', fields: 'timeZone' },
        })
        .then((row) => string(object(row).timeZone))
      calendarTimeZones.set(key, pending)
    }
    return pending
  }
  const verify = async (document: Reference) => {
    let failure: NativeSearchError | undefined
    for (const entry of clients) {
      signal.throwIfAborted()
      const client = entry.client
      try {
        if (provider === 'google_drive') {
          const row = object(
            await client.json(`/drive/v3/files/${segment(document.id)}`, {
              query: { fields: 'id,parents,driveId,mimeType,trashed', supportsAllDrives: 'true' },
            })
          )
          if (row.id !== document.id || row.trashed === true) continue
          if (await entry.verifyPolicy(document, row)) return true
        } else if (provider === 'gmail') {
          const row = object(
            await client.json(`/gmail/v1/users/me/messages/${segment(document.id)}`, {
              query: {
                format: 'metadata',
                metadataHeaders: ['Message-ID'],
                fields: 'id,labelIds,internalDate,payload/headers',
              },
            })
          )
          if (row.id !== document.id) continue
          const days: Record<string, number> = {
            '7d': 7,
            '30d': 30,
            '90d': 90,
            '6m': 180,
            '1y': 365,
          }
          const age = days[string(config.dateRange)]
          if (
            age &&
            (!Number.isFinite(Number(row.internalDate)) ||
              Number(row.internalDate) < Date.now() - age * 86400000)
          )
            continue
          if (!(await entry.verifyPolicy(document, row))) continue
          if (string(config.query).trim()) {
            const messageId = string(
              array(object(row.payload).headers).find(
                (header) => string(header.name).toLowerCase() === 'message-id'
              )?.value
            )
            if (!messageId || /[\r\n]/.test(messageId)) continue
            const matches = object(
              await client.json('/gmail/v1/users/me/messages', {
                query: {
                  q: `(${string(config.query)}) rfc822msgid:${JSON.stringify(messageId)}`,
                  maxResults: '100',
                },
              })
            )
            if (!array(matches.messages).some((row) => row.id === document.id)) continue
          }
          return true
        } else {
          const calendarId = document.container === 'primary' ? email : document.container
          if (!calendarId) continue
          const allowedCalendars = policy.included.map((id) =>
            id === 'primary' ? entry.email : id
          )
          if (policy.mode === 'selected' && !allowedCalendars.includes(calendarId)) continue
          const row = object(
            await client.json(
              `/calendar/v3/calendars/${segment(calendarId)}/events/${segment(document.id)}`
            )
          )
          if (row.id !== document.id || row.status === 'cancelled') continue
          const startValue = object(row.start)
          const endValue = object(row.end)
          const timeZone =
            !startValue.dateTime || !endValue.dateTime
              ? await calendarTimeZone(entry.email, calendarId, client)
              : ''
          const instant = (value: Record<string, unknown>) =>
            value.dateTime
              ? Date.parse(string(value.dateTime))
              : value.date && timeZone
                ? zonedWallClockToUtc(`${string(value.date)}T00:00:00`, timeZone).getTime()
                : Number.NaN
          const start = instant(startValue)
          const end = instant(endValue)
          if (
            !Number.isFinite(start) ||
            !Number.isFinite(end) ||
            end <= calendarWindow.start ||
            start >= calendarWindow.end
          )
            continue
          if (string(config.searchQuery).trim()) {
            if (!row.iCalUID) continue
            const matches = object(
              await client.json(`/calendar/v3/calendars/${segment(calendarId)}/events`, {
                query: {
                  q: string(config.searchQuery),
                  iCalUID: string(row.iCalUID),
                  timeMin: new Date(start - 1000).toISOString(),
                  timeMax: new Date(end + 1000).toISOString(),
                  singleEvents: 'true',
                  maxResults: '100',
                },
              })
            )
            if (!array(matches.items).some((item) => item.id === document.id)) continue
          }
          return true
        }
      } catch (error) {
        if (
          !(error instanceof NativeSearchError) ||
          !['reconnect', 'unavailable'].includes(error.status)
        )
          throw error
        failure ??= error
      }
    }
    if (failure) throw failure
    return false
  }
  return {
    verify,
    partial,
    scopeSearch(search) {
      if (!clients.length) return null
      if (provider === 'gmail') {
        const requestsPerMessage = string(config.query).trim() ? 2 : 1
        return {
          ...search,
          limit: Math.min(
            search.limit,
            Math.floor((SOURCE_REQUEST_BUDGET - 1) / requestsPerMessage)
          ),
        }
      }
      if (provider !== 'google_calendar') return search
      const start = Math.max(
        calendarWindow.start,
        search.filters?.startDate ? Date.parse(search.filters.startDate) : calendarWindow.start
      )
      const end = Math.min(
        calendarWindow.end,
        search.filters?.endDate ? Date.parse(search.filters.endDate) : calendarWindow.end
      )
      if (start >= end) return null
      /** Stable daily query bounds preserve pagination; exact rolling bounds are verified per event. */
      const queryStart = Math.max(
        Math.floor(calendarWindow.start / DAY_MS) * DAY_MS,
        search.filters?.startDate ? Date.parse(search.filters.startDate) : Number.NEGATIVE_INFINITY
      )
      const queryEnd = Math.min(
        (Math.floor(calendarWindow.end / DAY_MS) + 1) * DAY_MS,
        search.filters?.endDate ? Date.parse(search.filters.endDate) : Number.POSITIVE_INFINITY
      )
      const calendars = search.native?.project
        ? 1
        : Math.max(1, Math.min(policy.included.length, 6))
      const requestsPerEvent = string(config.searchQuery).trim() ? 2 : 1
      const pageLimit = Math.floor(
        (SOURCE_REQUEST_BUDGET - calendars) / (calendars * requestsPerEvent)
      )
      return {
        ...search,
        limit: Math.min(search.limit, pageLimit),
        filters: {
          ...search.filters,
          startDate: new Date(queryStart).toISOString(),
          endDate: new Date(queryEnd).toISOString(),
        },
      }
    },
  }
}
