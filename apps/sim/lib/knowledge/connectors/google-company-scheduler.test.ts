import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGoogleCompanyScheduler } from '@/lib/knowledge/connectors/google-company-scheduler'
import {
  beginListingCheckpoint,
  type ListingCheckpoint,
  runResumableListing,
} from '@/lib/knowledge/connectors/listing-checkpoint'
import type {
  ConnectorPartitionWorkChanges,
  ConnectorPartitionWorkItem,
  ConnectorPartitionWorkKind,
  ConnectorPartitionWorkStore,
} from '@/lib/knowledge/connectors/partition-work'
import { GoogleDriveApiError } from '@/connectors/google-drive/google-drive-errors'
import { GoogleApiError } from '@/connectors/google-workspace/api-errors'
import {
  GoogleWorkspaceMailboxNotSetup,
  listGoogleWorkspaceDocuments,
} from '@/connectors/google-workspace/company-crawl'
import { googleCompanyUserContextSchema } from '@/connectors/google-workspace/company-work'
import type { GoogleWorkspaceUser } from '@/connectors/google-workspace/users'
import type { ConnectorConfig, ExternalDocument, ExternalListingFailures } from '@/connectors/types'
import { memberDocumentId } from '@/connectors/utils'

const mocks = vi.hoisted(() => ({ directory: vi.fn(), getUser: vi.fn() }))
vi.mock('@/connectors/google-workspace/users', async (original) => ({
  ...(await original<typeof import('@/connectors/google-workspace/users')>()),
  listGoogleWorkspaceUsers: mocks.directory,
  getGoogleWorkspaceUser: mocks.getUser,
}))

const document: ExternalDocument = {
  externalId: 'doc',
  title: 'Document',
  content: 'Text',
  contentHash: 'hash',
  mimeType: 'text/plain',
}
function user(id: string, extra: Partial<GoogleWorkspaceUser> = {}): GoogleWorkspaceUser {
  return { id, email: `${id}@fixture.test`, customerId: 'customer', active: true, ...extra }
}
interface FakeWork extends ConnectorPartitionWorkItem<GoogleWorkspaceUser> {
  complete: boolean
  retryAt: Date
  served: number
  failure?: ExternalListingFailures['samples'][number]
}
const expiredCursor = new Error('expired provider cursor')
function fixture(provider = 'google_calendar', syncIntervalMinutes = 60) {
  let clock = new Date('2026-09-17T00:00:00Z')
  let served = 0
  const rows = new Map<string, FakeWork>()
  const key = (id: string, kind: ConnectorPartitionWorkKind) => `${id}:${kind}`
  const incomplete = (row: FakeWork) =>
    row.kind === 'content' ? !row.complete : Boolean(row.cursor || row.failure)
  const store: ConnectorPartitionWorkStore<GoogleWorkspaceUser> = {
    get: async (id, kind) => rows.get(key(id, kind)) ?? null,
    next: async (kind, now) =>
      [...rows.values()]
        .filter(
          (row) =>
            row.kind === kind &&
            row.retryAt <= now &&
            (kind !== 'content' ||
              !row.complete ||
              (syncIntervalMinutes > 0 && [...rows.values()].some(incomplete))) &&
            (kind === 'content' || (rows.get(key(row.partitionKey, 'content'))?.served ?? 0) > 0)
        )
        .sort((a, b) => a.served - b.served || a.partitionKey.localeCompare(b.partitionKey))[0] ??
      null,
    remaining: async () => {
      const remaining = [...rows.values()].filter(incomplete)
      const retryable = [...rows.values()].filter(
        (row) => incomplete(row) || (row.kind === 'content' && syncIntervalMinutes > 0)
      )
      const failed = [...rows.values()].filter((row) => row.failure)
      return {
        count: new Set(remaining.map((row) => row.partitionKey)).size,
        retryAt: remaining.length
          ? (retryable.sort((a, b) => +a.retryAt - +b.retryAt)[0]?.retryAt ?? null)
          : null,
        ...(failed.length
          ? {
              failures: {
                count: failed.length,
                samples: failed.map((row) => row.failure!).slice(0, 10),
              },
            }
          : {}),
      }
    },
  }
  const apply = (changes: ConnectorPartitionWorkChanges) => {
    for (const item of changes.enqueue ?? []) {
      if (rows.has(key(item.partitionKey, 'content'))) continue
      rows.set(key(item.partitionKey, 'content'), {
        ...item,
        context: { ...googleCompanyUserContextSchema.parse(item.context), active: true },
        kind: 'content',
        attempts: 0,
        hasFailure: false,
        complete: false,
        retryAt: clock,
        served: 0,
      })
      rows.set(key(item.partitionKey, 'permissions'), {
        partitionKey: item.partitionKey,
        context: { ...googleCompanyUserContextSchema.parse(item.context), active: true },
        kind: 'permissions',
        attempts: 0,
        hasFailure: false,
        complete: false,
        retryAt: new Date(+clock + 12 * 60 * 60 * 1000),
        served: 0,
      })
    }
    if (changes.pin)
      Object.assign(rows.get(key(changes.pin.partitionKey, changes.pin.kind))!, {
        cursor: changes.pin.cursor,
        permissionStartedAt: changes.pin.permissionStartedAt,
      })
    if (changes.update) {
      const change = changes.update
      Object.assign(rows.get(key(change.partitionKey, change.kind))!, {
        cursor: change.cursor ?? undefined,
        complete: change.kind === 'content' && change.completed,
        retryAt: change.retryAt,
        attempts: change.attempts,
        failure: change.failure ?? undefined,
        served: ++served,
        permissionStartedAt: change.permissionStartedAt ?? undefined,
      })
      for (const kind of ['content', 'permissions'] as const) {
        rows.get(key(change.partitionKey, kind))!.hasFailure = Boolean(
          rows.get(key(change.partitionKey, 'content'))?.failure ||
            rows.get(key(change.partitionKey, 'permissions'))?.failure
        )
      }
    }
  }
  const list = vi.fn<ConnectorConfig['listDocuments']>(async () => ({
    documents: [document],
    hasMore: false,
  }))
  const visible = vi.fn(async (_user: GoogleWorkspaceUser) => false)
  let scheduler = createGoogleCompanyScheduler({
    provider,
    store,
    listDocuments: list,
    hasVisibleDocuments: visible,
    syncIntervalMinutes,
    isListingCursorInvalidError: (error) => error === expiredCursor,
    now: () => clock,
  })
  let saved = beginListingCheckpoint({
    fingerprint: 'a'.repeat(64),
    generationId: 'generation',
    startedAt: clock,
  })
  const process = vi.fn(async () => undefined)
  const step = async (maxPages = 1) => {
    saved = await runResumableListing({
      connectorConfig: {
        listDocuments: scheduler.listDocuments,
        isListingCursorInvalidError: (error) => error === expiredCursor,
      },
      sourceConfig: {},
      syncContext: {},
      checkpoint: saved,
      deadlineAt: Date.now() + 60_000,
      maxPages,
      beforePage: async () => undefined,
      getAccessToken: async () => 'directory-token',
      processPage: process,
      saveCheckpoint: async (checkpoint) => {
        const changes = scheduler.changesFor(checkpoint.cursor)
        if (changes) apply(changes)
        saved = structuredClone(checkpoint)
        scheduler.didCommit(checkpoint.cursor)
      },
    })
    return saved
  }
  return {
    rows,
    list,
    visible,
    process,
    step,
    saved: () => saved,
    setSaved: (checkpoint: ListingCheckpoint) => {
      saved = checkpoint
    },
    advance: (ms: number) => {
      clock = new Date(+clock + ms)
    },
    restart: () => {
      scheduler = createGoogleCompanyScheduler({
        provider,
        store,
        listDocuments: list,
        hasVisibleDocuments: visible,
        syncIntervalMinutes,
        isListingCursorInvalidError: (error) => error === expiredCursor,
        now: () => clock,
      })
    },
  }
}

beforeEach(() => {
  mocks.directory.mockReset()
  mocks.getUser.mockReset().mockImplementation(async (_token: string, id: string) => user(id))
})

describe('durable Google company user scheduling', () => {
  it('reaches later Directory pages before draining a large first mailbox, then rotates its exact cursor', async () => {
    mocks.directory
      .mockResolvedValueOnce({ users: [user('a'), user('b')], nextPageToken: 'directory-2' })
      .mockResolvedValueOnce({ users: [user('z')] })
    const f = fixture()
    f.list.mockImplementation(async (_token, _config, cursor) => {
      if (cursor?.includes('large-page')) return { documents: [], hasMore: false }
      return { documents: [document], hasMore: true, nextCursor: 'large-page-2' }
    })
    await f.step(6)
    expect(mocks.directory).toHaveBeenCalledTimes(2)
    expect(f.rows.get('z:content')?.served).toBeGreaterThan(0)
    expect(f.list.mock.calls.some((call) => call[2] === 'large-page-2')).toBe(true)
    expect(f.saved().cursor!.length).toBeLessThan(2048)
  })

  it.each([
    ['google_calendar', [], false],
    ['google_calendar', ['forbidden'], true],
    ['google_calendar', ['notACalendarUser'], false],
    ['google_drive', [], false],
  ] as const)(
    'retains a failed %s user (%j, reasons complete: %s) and continues other users',
    async (provider, reasons, reasonsComplete) => {
      mocks.directory.mockResolvedValue({ users: [user('a'), user('z')] })
      const f = fixture(provider)
      f.list.mockRejectedValueOnce(
        provider === 'google_drive'
          ? new GoogleDriveApiError(403, [], 'drive.files.list', false)
          : new GoogleApiError('calendar.events.list', 403, reasons, reasonsComplete)
      )
      await f.step(4)
      expect(f.rows.get('a:content')).toMatchObject({
        complete: false,
        attempts: 1,
        failure: { status: 403, reasons },
      })
      expect(f.rows.get('z:content')?.complete).toBe(true)
      expect(f.saved()).toMatchObject({
        complete: false,
        unsafe: true,
        listingFailures: { count: 1 },
      })
      expect(f.saved().resumeAt).not.toBeNull()
      f.advance(10 * 60 * 1000)
      f.restart()
      await f.step(3)
      expect(f.rows.get('a:content')?.complete).toBe(true)
    }
  )

  it('completes Calendar users without the service so the listing stays reconcilable, re-probing them at the Directory refresh', async () => {
    mocks.directory.mockResolvedValue({ users: ['a', 'b', 'c', 'z'].map((id) => user(id)) })
    const f = fixture('google_calendar', 15)
    const listUserDocuments = vi.fn<ConnectorConfig['listDocuments']>(
      async (_token, _config, _cursor, ctx) => ({
        documents: [{ ...document, externalId: memberDocumentId('event', ctx) }],
        hasMore: false,
      })
    )
    for (let i = 0; i < 3; i++) {
      listUserDocuments.mockRejectedValueOnce(
        new GoogleApiError('calendar.events.list', 403, ['notACalendarUser'])
      )
    }
    const syncContext = {
      mirrorsSourceAcls: true,
      getDelegatedAccessToken: vi.fn(async () => 'user-token'),
    }
    f.list.mockImplementation(async (accessToken, sourceConfig, cursor) =>
      listGoogleWorkspaceDocuments({
        provider: 'google_calendar',
        accessToken,
        sourceConfig,
        cursor,
        syncContext,
        listUserDocuments,
      })
    )

    await f.step(10)

    for (const id of ['a', 'b', 'c']) {
      expect(f.rows.get(`${id}:content`)).toMatchObject({
        complete: true,
        attempts: 0,
        retryAt: new Date('2026-09-17T01:00:00Z'),
      })
      expect(f.rows.get(`${id}:content`)?.failure).toBeUndefined()
    }
    expect(f.rows.get('z:content')).toMatchObject({
      complete: true,
      retryAt: new Date('2026-09-17T00:15:00Z'),
    })
    expect(f.saved()).toMatchObject({ complete: true, unsafe: false, listingFailures: null })
    expect(listUserDocuments).toHaveBeenCalledTimes(4)
  })

  it.each([
    {
      provider: 'google_calendar',
      error: () => new GoogleApiError('calendar.events.list', 403, ['notACalendarUser']),
      reason: { operation: 'calendar.events.list', status: 403, reasons: ['notACalendarUser'] },
    },
    {
      provider: 'gmail',
      error: () => new GoogleWorkspaceMailboxNotSetup(),
      reason: { operation: 'directory.users.get', reasons: ['mailboxNotSetup'] },
    },
  ])(
    'retains a $provider user whose documents readers still see until the condition outlasts propagation',
    async ({ provider, error, reason }) => {
      mocks.directory.mockResolvedValue({ users: [user('a')] })
      const f = fixture(provider, 15)
      f.visible.mockResolvedValue(true)
      f.list.mockImplementation(async () => {
        throw error()
      })
      await f.step(5)
      const retained = {
        complete: false,
        failure: { scope: 'a@fixture.test', ...reason, since: '2026-09-17T00:00:00.000Z' },
      }
      expect(f.rows.get('a:content')).toMatchObject({ ...retained, attempts: 1 })
      expect(f.visible).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
      expect(f.saved()).toMatchObject({
        complete: false,
        unsafe: true,
        listingFailures: { count: 1 },
      })

      f.advance(23 * 60 * 60 * 1000)
      f.restart()
      await f.step(5)
      expect(f.rows.get('a:content')).toMatchObject({ ...retained, attempts: 2 })
      expect(f.visible).toHaveBeenCalledOnce()
      expect(f.saved().complete).toBe(false)

      f.advance(60 * 60 * 1000)
      f.restart()
      await f.step(5)
      expect(f.rows.get('a:content')).toMatchObject({ complete: true, attempts: 0 })
      expect(f.rows.get('a:content')?.failure).toBeUndefined()
      expect(f.saved()).toMatchObject({ complete: true, listingFailures: null })
    }
  )

  it('pins the provider snapshot before processing and replays it after interruption', async () => {
    mocks.directory.mockResolvedValue({ users: [user('a')] })
    const f = fixture()
    f.list.mockResolvedValue({
      documents: [document],
      currentCursor: 'stable-provider-snapshot',
      hasMore: true,
      nextCursor: 'next-provider-page',
    })
    await f.step()
    f.process.mockRejectedValueOnce(new Error('interrupted'))
    await expect(f.step()).rejects.toThrow('interrupted')
    expect(f.rows.get('a:content')?.cursor).toBe('stable-provider-snapshot')
    expect(f.saved().listedCount).toBe(0)
    f.restart()
    await f.step()
    expect(f.list.mock.calls.at(-1)?.[2]).toBe('stable-provider-snapshot')
    expect(f.rows.get('a:content')?.cursor).toBe('next-provider-page')
  })

  it('rejects an oversized continuation before making provider requests', async () => {
    const f = fixture()
    f.setSaved({ ...f.saved(), cursor: `google-company-work:v2:${'a'.repeat(20_000)}` })
    await expect(f.step()).rejects.toThrow('too large')
    expect(mocks.directory).not.toHaveBeenCalled()
    expect(f.list).not.toHaveBeenCalled()
  })

  it.each(['content', 'permissions'] as const)(
    'resets only the expired %s cursor, including interruption before the recovery commit',
    async (kind) => {
      mocks.directory.mockResolvedValue({ users: [user('a'), user('b')] })
      const f = fixture('google_drive')
      await f.step()
      const a = f.rows.get(`a:${kind}`)!
      a.cursor = 'expired-inner-cursor'
      a.retryAt = new Date('2026-09-17T00:00:00Z')
      a.permissionStartedAt = new Date('2026-09-16T00:00:00Z')
      if (kind === 'permissions') {
        const content = f.rows.get('a:content')!
        content.served = 1
        content.retryAt = new Date('2026-09-18T00:00:00Z')
      }
      const b = f.rows.get('b:content')!
      b.cursor = 'b-content-page-42'
      b.retryAt = new Date('2026-09-18T00:00:00Z')
      f.rows.get('b:permissions')!.cursor = 'b-permission-page-7'
      const beforeB = structuredClone(b)
      f.list.mockRejectedValue(expiredCursor)
      f.process.mockRejectedValueOnce(new Error('interrupted before recovery commit'))
      await expect(f.step()).rejects.toThrow('interrupted before recovery commit')
      expect(a.cursor).toBe('expired-inner-cursor')
      expect(f.saved().generationId).toBe('generation')
      f.restart()
      await f.step(3)
      expect(a.cursor).toContain('gdrive-company:v1:')
      expect(a.complete).toBe(false)
      expect(a.attempts).toBe(1)
      expect(a.retryAt).toEqual(new Date('2026-09-17T01:00:00Z'))
      if (kind === 'permissions') expect(a.permissionStartedAt).toBeUndefined()
      expect(f.rows.get('b:content')).toEqual(beforeB)
      expect(f.rows.get('b:permissions')?.cursor).toBe('b-permission-page-7')
      expect(f.saved()).toMatchObject({
        generationId: 'generation',
        listedCount: 0,
        complete: false,
      })
      expect(f.list).toHaveBeenCalledTimes(2)
    }
  )
})
