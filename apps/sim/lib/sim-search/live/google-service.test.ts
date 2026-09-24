/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorAccessToken } from '@/lib/knowledge/connectors/access-token'
import { searchCalendar } from '@/lib/sim-search/live/google'
import { createGoogleServiceVerifier } from '@/lib/sim-search/live/google-service'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import { liveSourcePolicy } from '@/lib/sim-search/live/source-policy'
import type { NativeClient, NativeSearchInput } from '@/lib/sim-search/live/types'

const mocks = vi.hoisted(() => ({ directory: vi.fn(), createClient: vi.fn() }))
vi.mock('@/connectors/google-workspace/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/connectors/google-workspace/users')>()),
  getGoogleWorkspaceUser: mocks.directory,
}))
vi.mock('@/lib/sim-search/live/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sim-search/live/http')>()),
  createNativeClient: mocks.createClient,
}))

const member = { json: vi.fn<NativeClient['json']>(), text: vi.fn() }
const delegated = { json: vi.fn<NativeClient['json']>(), text: vi.fn() }
const mint = vi.fn<NonNullable<ConnectorAccessToken['getDelegatedAccessToken']>>()
const token = { accessToken: 'directory-token', getDelegatedAccessToken: mint }
const person = (email: string) => ({ id: email, email, customerId: 'customer', active: true })
const create = (
  provider: 'gmail' | 'google_drive' | 'google_calendar',
  config: Record<string, unknown> = {}
) =>
  createGoogleServiceVerifier({
    provider,
    token,
    member,
    config: { adminEmail: 'admin@example.com', ...config },
    policy: liveSourcePolicy(provider, config),
    signal: new AbortController().signal,
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-22T12:00:00Z'))
  member.json.mockResolvedValue({ emailAddress: 'reader@example.com' })
  mocks.directory.mockImplementation(async (_token, email: string) => person(email))
  mocks.createClient.mockReturnValue(delegated)
  mint.mockResolvedValue('delegated-token')
})
afterEach(() => vi.useRealTimers())

describe('Google service delegation authority', () => {
  it('requires domain-wide delegation and never substitutes the source administrator for a member', async () => {
    await expect(
      createGoogleServiceVerifier({
        provider: 'gmail',
        token: { accessToken: 'token' },
        member,
        config: {},
        policy: liveSourcePolicy('gmail', {}),
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('domain-wide delegation')
    expect(member.json).not.toHaveBeenCalled()
    await create('gmail')
    expect(mint).toHaveBeenCalledExactlyOnceWith('reader@example.com', expect.any(AbortSignal))
    expect(member.json).toHaveBeenCalledWith('/gmail/v1/users/me/profile', undefined)
  })
  it('does not delegate a selected mailbox belonging to someone else', async () => {
    const session = await create('gmail', { userEmails: ['other@example.com'] })
    expect(await session.verify({ id: 'message' })).toBe(false)
    expect(mint).not.toHaveBeenCalled()
  })
  it.each([
    { active: false },
    { customerId: 'other-customer' },
    { email: 'different@example.com' },
  ])('rejects changed, suspended, or foreign directory identities: %j', async (changed) => {
    mocks.directory.mockImplementation(async (_token, email: string) => ({
      ...person(email),
      ...(email === 'reader@example.com' ? changed : {}),
    }))
    const session = await create('gmail')
    expect(await session.verify({ id: 'message' })).toBe(false)
    expect(mint).not.toHaveBeenCalled()
  })
  it('bounds selected Drive source users and marks incomplete verification', async () => {
    member.json.mockResolvedValue({ user: { emailAddress: 'reader@example.com' } })
    const selected = Array.from({ length: 7 }, (_, index) => `source${index}@example.com`)
    const session = await create('google_drive', { userEmails: selected })
    expect(session.partial).toBe(true)
    expect(mint.mock.calls.map(([email]) => email)).toEqual(selected.slice(0, 6))
    expect(mint).not.toHaveBeenCalledWith('reader@example.com', expect.anything())
  })
  it('uses bounded source-admin proof for an external Drive member and reports partial source coverage', async () => {
    member.json.mockResolvedValue({ user: { emailAddress: 'external@other.example' } })
    mocks.directory.mockImplementation(async (_token, email: string) =>
      email === 'admin@example.com' ? person(email) : null
    )
    delegated.json.mockResolvedValue({ id: 'shared-file', trashed: false })
    const session = await create('google_drive')
    expect(session.partial).toBe(true)
    expect(mint).toHaveBeenCalledExactlyOnceWith('admin@example.com', expect.any(AbortSignal))
    expect(await session.verify({ id: 'shared-file' })).toBe(true)
    expect(member.json).toHaveBeenCalledExactlyOnceWith('/drive/v3/about', {
      query: { fields: 'user(emailAddress)' },
    })
  })
})

describe('Google service source filtering', () => {
  it('verifies twenty Gmail results within the request budget using one message read each', async () => {
    let requests = 0
    delegated.json.mockImplementation(async (path) => {
      if (++requests > 30) throw new NativeSearchError('unavailable', 'Request budget reached')
      return path.endsWith('/labels')
        ? { labels: [{ id: 'INBOX', name: 'INBOX' }] }
        : { id: path.split('/').at(-1), labelIds: ['INBOX'], internalDate: String(Date.now()) }
    })
    const session = await create('gmail', { label: 'INBOX' })
    for (let index = 0; index < 20; index++)
      expect(await session.verify({ id: `message-${index}` })).toBe(true)
    expect(requests).toBe(21)
  })
  it('uses freshly fetched Gmail labels even when rechecking a document in the same session', async () => {
    let labels = ['INBOX']
    delegated.json.mockImplementation(async (path) =>
      path.endsWith('/labels')
        ? { labels: [{ id: 'INBOX', name: 'INBOX' }] }
        : { id: 'message', labelIds: labels, internalDate: String(Date.now()) }
    )
    const session = await create('gmail', { label: 'INBOX' })
    expect(await session.verify({ id: 'message' })).toBe(true)
    labels = ['SENT']
    expect(await session.verify({ id: 'message' })).toBe(false)
  })
  it('reuses source file metadata and shared ancestry across a twenty-result Drive page', async () => {
    let requests = 0
    member.json.mockResolvedValue({ user: { emailAddress: 'reader@example.com' } })
    delegated.json.mockImplementation(async (path) => {
      if (++requests > 30) throw new NativeSearchError('unavailable', 'Request budget reached')
      const id = path.split('/').at(-1)
      return id === 'folder'
        ? { id, parents: [] }
        : { id, parents: ['folder'], mimeType: 'text/plain' }
    })
    const session = await create('google_drive', { folderId: 'folder' })
    for (let index = 0; index < 20; index++)
      expect(await session.verify({ id: `file-${index}` })).toBe(true)
    expect(requests).toBe(21)
  })
  it('requires INBOX in the current delegated mailbox and suppresses excluded categories', async () => {
    delegated.json.mockImplementation(async (path) =>
      path.endsWith('/labels')
        ? { labels: [{ id: 'INBOX', name: 'INBOX' }] }
        : { id: 'message', labelIds: ['INBOX'], internalDate: String(Date.now()) }
    )
    expect(await (await create('gmail', { label: 'INBOX' })).verify({ id: 'message' })).toBe(true)
    delegated.json.mockResolvedValue({
      id: 'message',
      labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
      internalDate: String(Date.now()),
    })
    expect(await (await create('gmail', { label: 'INBOX' })).verify({ id: 'message' })).toBe(false)
    delegated.json.mockResolvedValue({
      id: 'message',
      labelIds: ['SENT'],
      internalDate: String(Date.now()),
    })
    expect(await (await create('gmail', { label: 'INBOX' })).verify({ id: 'message' })).toBe(false)
  })
  it('requires the exact message to satisfy the source Gmail query and date range', async () => {
    delegated.json.mockImplementation(async (path) =>
      path.endsWith('/messages')
        ? { messages: [{ id: 'different' }] }
        : {
            id: 'message',
            labelIds: [],
            internalDate: String(Date.now()),
            payload: { headers: [{ name: 'Message-ID', value: '<mail@example.com>' }] },
          }
    )
    const config = {
      query: 'from:customer@example.com',
      dateRange: '7d',
      excludePromotions: 'false',
      excludeSocial: 'false',
    }
    expect(await (await create('gmail', config)).verify({ id: 'message' })).toBe(false)
    expect(delegated.json).toHaveBeenLastCalledWith('/gmail/v1/users/me/messages', {
      query: {
        q: '(from:customer@example.com) rfc822msgid:"<mail@example.com>"',
        maxResults: '100',
      },
    })
    delegated.json.mockResolvedValue({
      id: 'message',
      internalDate: String(Date.now() - 8 * 86400000),
    })
    expect(await (await create('gmail', config)).verify({ id: 'message' })).toBe(false)
  })
  it('requires Drive service visibility and source ancestry, even if the member found a matching ID', async () => {
    member.json.mockResolvedValue({ user: { emailAddress: 'reader@example.com' } })
    delegated.json.mockImplementation(async (path) =>
      path.endsWith('/file')
        ? { id: 'file', parents: ['other'], mimeType: 'text/plain' }
        : { id: 'other' }
    )
    expect(
      await (await create('google_drive', { folderId: 'allowed' })).verify({ id: 'file' })
    ).toBe(false)
    delegated.json.mockRejectedValue(new NativeSearchError('unavailable', 'No source access'))
    await expect((await create('google_drive')).verify({ id: 'file' })).rejects.toThrow(
      'No source access'
    )
  })
  it('binds primary Calendar IDs to the provider-proven member and filters cancellation/date scope', async () => {
    member.json.mockResolvedValue({ id: 'reader@example.com' })
    delegated.json.mockResolvedValue({
      id: 'event',
      status: 'confirmed',
      start: { dateTime: '2026-09-22T12:30:00Z' },
      end: { dateTime: '2026-09-22T13:00:00Z' },
    })
    const session = await create('google_calendar')
    expect(await session.verify({ id: 'event', container: 'other@example.com' })).toBe(false)
    expect(delegated.json).not.toHaveBeenCalled()
    expect(await session.verify({ id: 'event', container: 'primary' })).toBe(true)
    expect(delegated.json).toHaveBeenLastCalledWith(
      '/calendar/v3/calendars/reader%40example.com/events/event'
    )
    delegated.json.mockResolvedValue({ id: 'event', status: 'cancelled' })
    expect(await session.verify({ id: 'event', container: 'primary' })).toBe(false)
  })
  it('propagates throttling instead of reporting verified empty coverage', async () => {
    delegated.json.mockRejectedValue(
      new NativeSearchError('rate_limited', 'Provider limit reached')
    )
    await expect((await create('gmail')).verify({ id: 'message' })).rejects.toThrow(
      'Provider limit reached'
    )
  })
  it('does not silently convert an incomplete multi-user Drive check into a denial', async () => {
    member.json.mockResolvedValue({ user: { emailAddress: 'reader@example.com' } })
    const unavailable = {
      json: vi.fn().mockRejectedValue(new NativeSearchError('unavailable', 'Source timed out')),
      text: vi.fn(),
    }
    const denied = { json: vi.fn().mockResolvedValue({ id: 'file', trashed: true }), text: vi.fn() }
    mocks.createClient.mockReturnValueOnce(unavailable).mockReturnValueOnce(denied)
    const session = await create('google_drive', {
      userEmails: ['first@example.com', 'second@example.com'],
    })
    await expect(session.verify({ id: 'file' })).rejects.toThrow('Source timed out')
  })
  it('checks all-day Calendar events in their calendar timezone at date-window boundaries', async () => {
    vi.setSystemTime(new Date('2026-09-22T02:00:00Z'))
    member.json.mockResolvedValue({ id: 'reader@example.com' })
    delegated.json.mockImplementation(async (path) =>
      path.endsWith('/events/event')
        ? {
            id: 'event',
            status: 'confirmed',
            start: { date: '2026-09-21' },
            end: { date: '2026-09-22' },
          }
        : { timeZone: 'America/Los_Angeles' }
    )
    expect(
      await (await create('google_calendar', { dateRange: 'future_only' })).verify({
        id: 'event',
        container: 'primary',
      })
    ).toBe(true)
    expect(delegated.json).toHaveBeenCalledWith(
      '/calendar/v3/calendars/reader%40example.com/events',
      {
        query: { maxResults: '1', fields: 'timeZone' },
      }
    )
    for (const [path] of delegated.json.mock.calls) expect(path).toMatch(/\/events(\/|$)/)
  })
  it('verifies twenty all-day events within the request budget and refreshes timezones next session', async () => {
    vi.setSystemTime(new Date('2026-09-22T02:00:00Z'))
    member.json.mockResolvedValue({ id: 'reader@example.com' })
    let requests = 0
    let timeZone = 'America/Los_Angeles'
    delegated.json.mockImplementation(async (path) => {
      if (++requests > 30) throw new NativeSearchError('unavailable', 'Request budget reached')
      return path.includes('/events/')
        ? {
            id: path.split('/').at(-1),
            status: 'confirmed',
            start: { date: '2026-09-21' },
            end: { date: '2026-09-22' },
          }
        : { timeZone }
    })
    const session = await create('google_calendar', { dateRange: 'future_only' })
    for (let index = 0; index < 20; index++)
      expect(await session.verify({ id: `event-${index}`, container: 'primary' })).toBe(true)
    expect(requests).toBe(21)
    timeZone = 'UTC'
    const refreshed = await create('google_calendar', { dateRange: 'future_only' })
    expect(await refreshed.verify({ id: 'event-0', container: 'primary' })).toBe(false)
    expect(requests).toBe(23)
  })
  it('keeps timezone metadata isolated between calendars', async () => {
    vi.setSystemTime(new Date('2026-09-22T02:00:00Z'))
    member.json.mockResolvedValue({ id: 'reader@example.com' })
    delegated.json.mockImplementation(async (path) =>
      path.includes('/events/')
        ? {
            id: 'event',
            status: 'confirmed',
            start: { date: '2026-09-21' },
            end: { date: '2026-09-22' },
          }
        : { timeZone: path.includes('west') ? 'America/Los_Angeles' : 'UTC' }
    )
    const session = await create('google_calendar', {
      dateRange: 'future_only',
      calendarId: ['west@example.com', 'utc@example.com'],
    })
    expect(await session.verify({ id: 'event', container: 'west@example.com' })).toBe(true)
    expect(await session.verify({ id: 'event', container: 'utc@example.com' })).toBe(false)
  })
})

describe('Google service search scope and continuation', () => {
  it('passes the source date window to Calendar so recurring events expand before verification', async () => {
    member.json.mockResolvedValue({ id: 'reader@example.com' })
    const session = await create('google_calendar')
    const native = {
      provider: 'google_calendar' as const,
      query: '',
      project: 'primary',
      cursor: 'previous',
    }
    const scoped = session.scopeSearch({
      query: '',
      limit: 20,
      scopes: [],
      policy: liveSourcePolicy('google_calendar', {}),
      native,
    })
    expect(scoped?.filters).toMatchObject({
      startDate: '2026-08-23T00:00:00.000Z',
      endDate: '2026-10-23T00:00:00.000Z',
    })
    expect(scoped?.native).toEqual(native)
    vi.setSystemTime(new Date('2026-09-22T12:01:00Z'))
    const continued = await create('google_calendar')
    expect(continued.scopeSearch({ query: '', limit: 20, scopes: [], native })?.filters).toEqual(
      scoped?.filters
    )
    delegated.json.mockResolvedValue({
      id: 'outside',
      start: { dateTime: '2026-08-23T08:00:00Z' },
      end: { dateTime: '2026-08-23T09:00:00Z' },
    })
    expect(await continued.verify({ id: 'outside', container: 'primary' })).toBe(false)
    member.json.mockResolvedValue({ items: [], nextPageToken: 'next', timeZone: 'UTC' })
    const page = await searchCalendar(member, scoped!)
    expect(member.json).toHaveBeenLastCalledWith('/calendar/v3/calendars/primary/events', {
      query: {
        timeMin: '2026-08-22T23:59:59.000Z',
        timeMax: '2026-10-23T00:00:00.000Z',
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '20',
        showDeleted: 'false',
        pageToken: 'previous',
      },
    })
    expect(page.nextCursor).toBe('next')
  })
  it('intersects user dates with source dates and leaves modification filters independent', async () => {
    member.json.mockResolvedValue({ id: 'reader@example.com' })
    const session = await create('google_calendar')
    const search: NativeSearchInput = {
      query: 'standup',
      limit: 20,
      scopes: [],
      filters: {
        startDate: '2026-09-25T00:00:00Z',
        endDate: '2026-09-26T00:00:00Z',
        modifiedAfter: '2026-09-01T00:00:00Z',
      },
    }
    expect(session.scopeSearch(search)?.filters).toEqual({
      startDate: '2026-09-25T00:00:00.000Z',
      endDate: '2026-09-26T00:00:00.000Z',
      modifiedAfter: '2026-09-01T00:00:00Z',
    })
    expect(search.filters?.startDate).toBe('2026-09-25T00:00:00Z')
    expect(
      session.scopeSearch({
        ...search,
        filters: { startDate: '2026-11-01T00:00:00Z', endDate: '2026-11-02T00:00:00Z' },
      })
    ).toBeNull()
  })
  it('bounds verification across six selected calendars and accounts for custom-query checks', async () => {
    member.json.mockResolvedValue({ id: 'reader@example.com' })
    const calendars = Array.from({ length: 6 }, (_, index) => `calendar-${index}@example.com`)
    const search = { query: 'standup', limit: 20, scopes: [] }
    expect(
      (await create('google_calendar', { calendarId: calendars })).scopeSearch(search)?.limit
    ).toBe(4)
    const custom = await create('google_calendar', {
      calendarId: calendars,
      searchQuery: 'engineering',
    })
    expect(custom.scopeSearch(search)?.limit).toBe(2)
    const native = {
      provider: 'google_calendar' as const,
      query: 'standup',
      project: calendars[0]!,
      cursor: 'previous',
    }
    expect(custom.scopeSearch({ ...search, native })).toMatchObject({ limit: 14, native })
  })
  it('caps custom Gmail query pages before fetching while preserving the provider cursor', async () => {
    const native = { provider: 'gmail' as const, query: 'launch', cursor: 'previous' }
    const search = { query: 'launch', limit: 20, scopes: [], native }
    const custom = await create('gmail', { label: 'INBOX', query: 'from:customer@example.com' })
    expect(custom.scopeSearch(search)).toMatchObject({ limit: 14, native })
    expect((await create('gmail')).scopeSearch({ ...search, limit: 50 })).toMatchObject({
      limit: 29,
      native,
    })
  })
})
