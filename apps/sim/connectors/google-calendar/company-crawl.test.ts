/**
 * @vitest-environment node
 */
import { inputValidationMock } from '@sim/testing'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListUsers, mockGetUser } = vi.hoisted(() => ({
  mockListUsers: vi.fn(),
  mockGetUser: vi.fn(),
}))

vi.mock('@/connectors/google-workspace/users', () => ({
  GOOGLE_WORKSPACE_USERS_PAGE_SIZE: 100,
  listGoogleWorkspaceUsers: mockListUsers,
  getGoogleWorkspaceUser: mockGetUser,
  selectedGoogleWorkspaceUsers: (value: unknown) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((email) => email.trim())
          .filter(Boolean)
      : [],
}))

import { googleCalendarConnector } from '@/connectors/google-calendar/google-calendar'
import { googleCalendarConnectorMeta } from '@/connectors/google-calendar/meta'

const ALICE = { id: 'id-alice', email: 'alice@example.com', customerId: 'customer-1', active: true }
const BOB = { id: 'id-bob', email: 'bob@example.com', customerId: 'customer-1', active: true }
const EVENT = {
  id: 'meeting-1',
  eventType: 'default',
  summary: 'Private planning',
  description: 'Owner-only details',
  updated: '2026-09-09T00:00:00Z',
  start: { dateTime: '2026-09-10T10:00:00Z', timeZone: 'UTC' },
  end: { dateTime: '2026-09-10T11:00:00Z', timeZone: 'UTC' },
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const fetchMock = vi.fn<typeof fetch>()

function context() {
  return {
    mirrorsSourceAcls: true,
    getDelegatedAccessToken: vi.fn(async (email: string) => `delegated:${email}`),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockListUsers.mockResolvedValue({ users: [ALICE, BOB] })
  mockGetUser.mockImplementation(
    async (_token: string, id: string) =>
      [ALICE, BOB].find((user) => user.id === id || user.email === id) ?? null
  )
  fetchMock.mockImplementation(async () => response({ items: [EVENT] }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Google Calendar company crawl', () => {
  it('declares independent read-only Directory and delegated Calendar scopes', () => {
    expect(googleCalendarConnectorMeta.auth).toMatchObject({
      requiredScopes: ['https://www.googleapis.com/auth/calendar'],
      adminCredentialType: 'service_account',
      adminServiceAccountScopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
      serviceAccountDelegationScopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
      serviceAccountSubjectFieldId: 'adminEmail',
    })
    expect(
      googleCalendarConnectorMeta.configFields.find((field) => field.id === 'calendarSelector')
        ?.hideInAdminMode
    ).toBe(true)
    expect(
      googleCalendarConnectorMeta.configFields.find((field) => field.id === 'calendarId')
        ?.hideInAdminMode
    ).not.toBe(true)
    expect(googleCalendarConnectorMeta.supportsSeparateContentCredential).toBeUndefined()
  })

  it('isolates two users of the same calendar and event using verified user identities', async () => {
    const syncContext = context()
    const first = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      undefined,
      syncContext
    )
    expect(first.hasMore).toBe(true)
    expect(first.documents[0].acl).toEqual(['u:alice@example.com'])
    const second = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      first.nextCursor,
      syncContext
    )
    expect(second.hasMore).toBe(false)
    expect(second.documents[0].acl).toEqual(['u:bob@example.com'])
    expect(second.documents[0].externalId).not.toBe(first.documents[0].externalId)
    expect(syncContext.getDelegatedAccessToken.mock.calls).toEqual([[ALICE.email], [BOB.email]])
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).not.toMatchObject({ Authorization: 'Bearer directory-token' })
    }
  })

  it('keeps an organizer’s full event separate from a reader’s restricted representation', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const owner =
        new Headers(init?.headers).get('Authorization') === `Bearer delegated:${ALICE.email}`
      return response({
        items: [
          {
            ...EVENT,
            summary: owner ? 'Private planning' : 'Busy',
            description: owner ? 'Owner-only details' : undefined,
          },
        ],
      })
    })
    const syncContext = context()
    const owner = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      undefined,
      syncContext
    )
    const reader = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      owner.nextCursor,
      syncContext
    )
    expect(owner.documents[0].content).toContain('Owner-only details')
    expect(reader.documents[0].content).not.toContain('Owner-only details')
    expect(reader.documents[0].contentHash).not.toBe(owner.documents[0].contentHash)
    expect(reader.documents[0].acl).toEqual([`u:${BOB.email}`])
  })

  it('omits bare free/busy, cancelled, and status entries, while retaining declined recurring meetings', async () => {
    fetchMock.mockResolvedValue(
      response({
        items: [
          { id: 'busy', start: EVENT.start, end: EVENT.end },
          { ...EVENT, id: 'cancelled', status: 'cancelled' },
          { ...EVENT, id: 'out-of-office', eventType: 'outOfOffice' },
          { ...EVENT, id: 'working-location', eventType: 'workingLocation' },
          { ...EVENT, id: 'focus-time', eventType: 'focusTime' },
          { ...EVENT, id: 'birthday', eventType: 'birthday' },
          {
            ...EVENT,
            id: 'recurring_20260910',
            recurringEventId: 'series',
            attendees: [{ email: ALICE.email, self: true, responseStatus: 'declined' }],
          },
          { ...EVENT, id: 'all-day', start: { date: '2026-09-10' }, end: { date: '2026-09-11' } },
        ],
      })
    )
    const page = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      undefined,
      context()
    )
    expect(page.documents).toHaveLength(2)
    expect(page.documents[0].content).toContain('Response: declined')
    expect(page.documents[0].metadata?.responseStatus).toBe('declined')
    expect(page.documents[1].metadata?.isAllDay).toBe(true)
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('singleEvents')).toBe(
      'true'
    )
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('eventTypes')).toBe(
      'default'
    )
  })

  it('pins the initial date window during replay, continues empty provider pages, then advances users', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T10:00:00Z'))
    fetchMock.mockImplementation(async (url) =>
      response(
        new URL(String(url)).searchParams.has('pageToken')
          ? { items: [EVENT] }
          : { items: [], nextPageToken: 'page-two' }
      )
    )
    const first = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      undefined,
      context()
    )
    expect(first.documents).toEqual([])
    expect(first.hasMore).toBe(true)
    const firstWindow = new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('timeMin')
    vi.setSystemTime(new Date('2026-09-12T10:00:00Z'))
    const replay = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      first.currentCursor,
      context()
    )
    expect(replay.currentCursor).toBe(first.currentCursor)
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('timeMin')).toBe(
      firstWindow
    )
    const continuation = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      first.nextCursor,
      context()
    )
    expect(continuation.documents[0].acl).toEqual([`u:${ALICE.email}`])
    expect(new URL(String(fetchMock.mock.calls[2][0])).searchParams.get('timeMin')).toBe(
      firstWindow
    )
    const nextUser = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      continuation.nextCursor,
      context()
    )
    expect(nextUser.hasMore).toBe(true)
    expect(new Headers(fetchMock.mock.calls[3][1]?.headers).get('Authorization')).toBe(
      `Bearer delegated:${BOB.email}`
    )
  })

  it('binds deferred hydration to the active page’s verified identity, never an admin token', async () => {
    const syncContext = context()
    const first = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      undefined,
      syncContext
    )
    const id = first.documents[0].externalId
    fetchMock.mockResolvedValueOnce(response(EVENT))
    const hydrated = await googleCalendarConnector.getDocument(
      'directory-token',
      {},
      id,
      syncContext
    )
    expect(hydrated?.acl).toEqual([`u:${ALICE.email}`])
    expect(syncContext.getDelegatedAccessToken).toHaveBeenCalledTimes(1)
    await expect(
      googleCalendarConnector.getDocument('directory-token', {}, id, context())
    ).rejects.toThrow('verified delegated listing identity')
    await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      first.nextCursor,
      syncContext
    )
    await expect(
      googleCalendarConnector.getDocument('directory-token', {}, id, syncContext)
    ).rejects.toThrow('verified delegated listing identity')
  })

  it('rejects a different event returned during hydration', async () => {
    const syncContext = context()
    const first = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      undefined,
      syncContext
    )
    fetchMock.mockResolvedValueOnce(response({ ...EVENT, id: 'different-event' }))
    await expect(
      googleCalendarConnector.getDocument(
        'directory-token',
        {},
        first.documents[0].externalId,
        syncContext
      )
    ).rejects.toThrow('different event')
  })

  it('continues past inaccessible configured calendars and preserves later shared calendars and users', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const alice =
        new Headers(init?.headers).get('Authorization') === `Bearer delegated:${ALICE.email}`
      const denied = String(url).includes('/calendars/restricted/') && alice
      return response(denied ? { error: { code: 404 } } : { items: [EVENT] }, denied ? 404 : 200)
    })
    const config = { calendarId: 'restricted,primary' }
    const first = await googleCalendarConnector.listDocuments(
      'directory-token',
      config,
      undefined,
      context()
    )
    expect(first.documents).toEqual([])
    expect(first.hasMore).toBe(true)
    const second = await googleCalendarConnector.listDocuments(
      'directory-token',
      config,
      first.nextCursor,
      context()
    )
    expect(second.documents[0].metadata?.calendarId).toBe('primary')
    expect(second.documents[0].acl).toEqual([`u:${ALICE.email}`])
    const third = await googleCalendarConnector.listDocuments(
      'directory-token',
      config,
      second.nextCursor,
      context()
    )
    expect(third.documents[0].metadata?.calendarId).toBe('restricted')
    expect(third.documents[0].acl).toEqual([`u:${BOB.email}`])
  })

  it('treats a sole inaccessible calendar as empty for that user and continues to the next user', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { code: 404 } }, 404))
    const first = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      undefined,
      context()
    )
    expect(first.documents).toEqual([])
    expect(first.hasMore).toBe(true)
    const next = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      first.nextCursor,
      context()
    )
    expect(next.documents[0].acl).toEqual([`u:${BOB.email}`])
  })

  it.each([401, 403])(
    'propagates provider HTTP %s without completing a user’s listing',
    async (status) => {
      fetchMock.mockResolvedValue(response({ error: { code: status } }, status))
      await expect(
        googleCalendarConnector.listDocuments('directory-token', {}, undefined, context())
      ).rejects.toThrow()
    }
  )

  it('skips a user who became inactive before their page and never delegates to them', async () => {
    mockGetUser.mockResolvedValueOnce({ ...ALICE, active: false })
    const syncContext = context()
    const first = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      undefined,
      syncContext
    )
    expect(first.documents).toEqual([])
    expect(first.hasMore).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(syncContext.getDelegatedAccessToken).not.toHaveBeenCalled()
  })

  it('forwards cancellation without accepting an empty successful listing', async () => {
    const controller = new AbortController()
    const syncContext = { ...context(), signal: controller.signal }
    fetchMock.mockImplementation(async (_url, init) => {
      expect(init?.signal).toBe(controller.signal)
      controller.abort()
      return response({ items: [] })
    })
    await expect(
      googleCalendarConnector.listDocuments('directory-token', {}, undefined, syncContext)
    ).rejects.toThrow()
  })

  it.each([
    {},
    { items: null },
    { items: [{ summary: 'Missing ID' }] },
    { items: [], nextPageToken: 123 },
  ])(
    'rejects malformed provider payloads rather than treating them as empty (%j)',
    async (payload) => {
      fetchMock.mockResolvedValue(response(payload))
      await expect(
        googleCalendarConnector.listDocuments('directory-token', {}, undefined, context())
      ).rejects.toThrow()
    }
  )

  it('accepts Google’s typed empty result and continues to the next user', async () => {
    fetchMock.mockResolvedValue(response({ kind: 'calendar#events' }))
    const first = await googleCalendarConnector.listDocuments(
      'directory-token',
      {},
      undefined,
      context()
    )
    expect(first.documents).toEqual([])
    expect(first.hasMore).toBe(true)
  })

  it('rejects an oversized page before it can grow the working document set', async () => {
    fetchMock.mockResolvedValue(
      response({ items: Array.from({ length: 251 }, (_, i) => ({ ...EVENT, id: `event-${i}` })) })
    )
    await expect(
      googleCalendarConnector.listDocuments('directory-token', {}, undefined, context())
    ).rejects.toThrow()
  })

  it('validates delegation using the selected user’s primary calendar, not the admin or shared-calendar picker', async () => {
    const syncContext = context()
    const result = await googleCalendarConnector.validateConfig(
      'directory-token',
      {
        adminEmail: ALICE.email,
        userEmails: BOB.email,
        calendarId: 'shared-calendar',
      },
      syncContext
    )
    expect(result).toEqual({ valid: true })
    expect(syncContext.getDelegatedAccessToken).toHaveBeenCalledWith(BOB.email)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/calendars/primary/events?')
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe(
      `Bearer delegated:${BOB.email}`
    )
  })

  it('reports missing Directory identity, invalid credentials, and invalid cursors without a provider fallback', async () => {
    expect(
      await googleCalendarConnector.validateConfig('directory-token', {}, context())
    ).toMatchObject({ valid: false })
    expect(
      await googleCalendarConnector.validateConfig(
        'oauth-token',
        { adminEmail: ALICE.email },
        { mirrorsSourceAcls: true }
      )
    ).toMatchObject({ valid: false })
    const error = await googleCalendarConnector
      .listDocuments('directory-token', {}, 'malformed', context())
      .catch((caught: unknown) => caught)
    expect(googleCalendarConnector.isListingCursorInvalidError?.(error)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires a delegated service account and rejects capped company listings', async () => {
    await expect(
      googleCalendarConnector.listDocuments('oauth-token', {}, undefined, {
        mirrorsSourceAcls: true,
      })
    ).rejects.toThrow('service account')
    await expect(
      googleCalendarConnector.listDocuments(
        'directory-token',
        { maxEvents: 1 },
        undefined,
        context()
      )
    ).rejects.toThrow('Max Events')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
