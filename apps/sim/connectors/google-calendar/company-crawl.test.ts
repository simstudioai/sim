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
})

describe('Google Calendar company crawl', () => {
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

  it.each([
    { status: 401, reason: 'authError' },
    { status: 403, reason: 'insufficientPermissions' },
    { status: 403, reason: 'SERVICE_DISABLED' },
  ])(
    'propagates provider authorization failures without completing a listing: $reason',
    async ({ status, reason }) => {
      fetchMock.mockResolvedValue(response({ error: { errors: [{ reason }] } }, status))
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

  it('rejects an oversized page before it can grow the working document set', async () => {
    fetchMock.mockResolvedValue(
      response({ items: Array.from({ length: 251 }, (_, i) => ({ ...EVENT, id: `event-${i}` })) })
    )
    await expect(
      googleCalendarConnector.listDocuments('directory-token', {}, undefined, context())
    ).rejects.toThrow()
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
