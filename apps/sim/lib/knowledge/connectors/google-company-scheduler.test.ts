/** @vitest-environment node */

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
import { listGoogleWorkspaceDocuments } from '@/connectors/google-workspace/company-crawl'
import { googleCompanyUserContextSchema } from '@/connectors/google-workspace/company-work'
import type { GoogleWorkspaceUser } from '@/connectors/google-workspace/users'
import { ConnectorSourceError } from '@/connectors/source-error'
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
function user(id: string): GoogleWorkspaceUser {
  return { id, email: `${id}@fixture.test`, customerId: 'customer', active: true }
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
  let scheduler = createGoogleCompanyScheduler({
    provider,
    store,
    listDocuments: list,
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
    ['google_calendar', []],
    ['google_calendar', ['notACalendarUser']],
    ['google_drive', []],
  ] as const)(
    'retains a failed %s user (%j) and continues other users',
    async (provider, reasons) => {
      mocks.directory.mockResolvedValue({ users: [user('a'), user('z')] })
      const f = fixture(provider)
      f.list.mockRejectedValueOnce(
        provider === 'google_drive'
          ? new GoogleDriveApiError(403, [], 'drive.files.list', false)
          : new GoogleApiError('calendar.events.list', 403, reasons, reasons.length > 0)
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

  it.each(['insufficientPermissions', 'rateLimitExceeded', 'SERVICE_DISABLED'])(
    'keeps %s as a connector-level failure',
    async (reason) => {
      mocks.directory.mockResolvedValue({ users: [user('a')] })
      const f = fixture()
      const error = new GoogleApiError('calendar.events.list', 403, [reason])
      f.list.mockRejectedValue(error)
      await f.step()
      await expect(f.step()).rejects.toBe(error)
      expect(f.rows.get('a:content')?.attempts).toBe(0)
    }
  )

  it('continues past unavailable Calendar users without the unresolved-error pause and retries them later', async () => {
    mocks.directory.mockResolvedValue({ users: ['a', 'b', 'c', 'z'].map(user) })
    const f = fixture()
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

    await f.step(5)

    expect(f.rows.get('z:content')?.complete).toBe(true)
    expect(f.saved()).toMatchObject({ complete: false, unsafe: true, resumeAt: null })
    for (const id of ['a', 'b', 'c']) {
      expect(f.rows.get(`${id}:content`)).toMatchObject({
        complete: false,
        attempts: 1,
        retryAt: new Date('2026-09-17T01:00:00Z'),
        failure: { status: 403, reasons: ['notACalendarUser'] },
      })
    }

    f.advance(60 * 60 * 1000)
    f.restart()
    await f.step(4)

    for (const id of ['a', 'b', 'c']) {
      expect(f.rows.get(`${id}:content`)).toMatchObject({ complete: true, attempts: 0 })
      expect(f.rows.get(`${id}:content`)?.failure).toBeUndefined()
    }
  })

  it('bounds a run of unresolved user errors rather than marking the tenant complete', async () => {
    mocks.directory.mockResolvedValue({ users: ['a', 'b', 'c', 'd'].map(user) })
    const f = fixture()
    f.list.mockRejectedValue(new GoogleApiError('calendar.events.list', 403, [], false))
    await f.step(25)
    expect(f.list).toHaveBeenCalledTimes(3)
    expect(f.saved()).toMatchObject({ complete: false, unsafe: true })
    expect(f.rows.get('d:content')?.served).toBe(0)
    expect(f.saved().resumeAt).toBe('2026-09-17T00:05:00.000Z')
  })

  it.each([
    {
      provider: 'gmail',
      prefix: 'google-workspace:v1:',
      state: { provider: 'gmail', providerCursor: 'existing-page-91' },
    },
    {
      provider: 'google_calendar',
      prefix: 'google-workspace:v1:',
      state: { provider: 'google_calendar', providerCursor: 'existing-page-91' },
    },
    {
      provider: 'google_drive',
      prefix: 'gdrive-company:v1:',
      state: { scope: { kind: 'user', cursor: 'existing-page-91' } },
    },
    {
      provider: 'google_drive',
      prefix: 'gdrive-company:v1:',
      state: { scope: { kind: 'drives', pageToken: 'existing-drives-page-91' } },
    },
    {
      provider: 'google_drive',
      prefix: 'gdrive-company:v1:',
      state: {
        scope: {
          kind: 'drive',
          driveIds: ['shared-drive'],
          nextPageToken: 'next-drives-page',
          cursor: 'existing-page-91',
        },
      },
    },
  ])(
    'adopts $provider legacy state $state without resetting the active page',
    async ({ provider, prefix, state }) => {
      mocks.directory.mockResolvedValue({ users: [user('a'), user('z')] })
      const f = fixture(provider)
      const legacy = `${prefix}${Buffer.from(JSON.stringify({ ...state, users: [user('a')], nextUsersPageToken: 'old-directory' })).toString('base64url')}`
      const generationId = f.saved().generationId
      f.setSaved({ ...f.saved(), cursor: legacy, listedCount: 10 })
      await f.step(3)
      expect(f.list.mock.calls[0]?.[2]).toContain(prefix)
      const resume = JSON.parse(
        Buffer.from(f.list.mock.calls[0]![2]!.slice(prefix.length), 'base64url').toString()
      )
      expect(resume).toMatchObject(state)
      expect(resume.users).toEqual([{ id: 'a', email: 'a@fixture.test', customerId: 'customer' }])
      expect(f.saved()).toMatchObject({ generationId, listedCount: 11 })
      expect(mocks.directory.mock.calls[0]?.[1]).toBeUndefined()
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

  it('refreshes permissions with a separate cursor while content remains unfinished', async () => {
    mocks.directory.mockResolvedValue({ users: [user('a'), user('z')] })
    const f = fixture()
    f.list.mockResolvedValue({ documents: [document], hasMore: true, nextCursor: 'next-page' })
    await f.step(2)
    const contentCursor = f.rows.get('a:content')?.cursor
    f.advance(13 * 60 * 60 * 1000)
    await f.step(2)
    expect(f.process.mock.calls.at(-1)?.[2]).toMatchObject({ permissionsOnly: true })
    expect(f.rows.get('a:content')?.cursor).toBe(contentCursor)
    expect(f.rows.get('a:permissions')?.cursor).toBe('next-page')
    expect(f.saved().listedCount).toBe(1)
    await f.step()
    expect(f.rows.get('z:content')?.served).toBeGreaterThan(0)
  })

  it('restarts expired Directory discovery without losing committed user work', async () => {
    mocks.directory
      .mockResolvedValueOnce({ users: [user('a')], nextPageToken: 'expired' })
      .mockRejectedValueOnce(new ConnectorSourceError('expired', 400))
      .mockResolvedValueOnce({ users: [user('a'), user('z')] })
    const f = fixture()
    f.list.mockResolvedValue({
      documents: [document],
      hasMore: true,
      nextCursor: 'saved-user-page',
    })
    await f.step(4)
    expect(f.rows.get('a:content')?.cursor).toBe('saved-user-page')
    expect(f.rows.has('z:content')).toBe(true)
  })

  it('discovers new employees and rescans healthy users while an unavailable mailbox stays blocked', async () => {
    mocks.directory
      .mockResolvedValueOnce({ users: [user('a'), user('z')] })
      .mockResolvedValue({ users: [user('a'), user('new'), user('z')] })
    const f = fixture()
    f.list.mockImplementation(async (_token, _config, cursor) => {
      const state = JSON.parse(Buffer.from(cursor!.split(':v1:')[1], 'base64url').toString())
      if (state.users[0].id === 'a')
        return {
          documents: [],
          hasMore: false,
          listingFailures: {
            count: 1,
            samples: [
              {
                scope: 'a@fixture.test',
                operation: 'directory.users.get',
                reasons: ['mailboxNotSetup'],
              },
            ],
          },
        }
      return { documents: [{ ...document, externalId: state.users[0].id }], hasMore: false }
    })
    await f.step(4)
    const oldCount = f.saved().listedCount
    expect(f.rows.get('a:content')?.complete).toBe(false)
    expect(f.rows.get('z:content')?.complete).toBe(true)
    f.advance(61 * 60_000)
    f.restart()
    await f.step(5)
    expect(f.rows.get('new:content')?.complete).toBe(true)
    expect(f.rows.get('z:content')?.complete).toBe(true)
    expect(f.saved().listedCount).toBe(oldCount + 2)
    expect(f.saved().complete).toBe(false)
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

  it('schedules completed users at the supplied refresh cadence', async () => {
    mocks.directory.mockResolvedValue({ users: [user('a'), user('b')] })
    const f = fixture('gmail', 15)
    await f.step(2)
    expect(f.rows.get('a:content')?.retryAt).toEqual(new Date('2026-09-17T00:15:00Z'))
  })

  it.each([0, 60])(
    'waits for deferred permissions at cadence %i, then reaches EOF without waiting for periodic refresh',
    async (cadence) => {
      mocks.directory.mockResolvedValue({ users: [user('a')] })
      const f = fixture('google_calendar', cadence)
      await f.step(2)
      const content = structuredClone(f.rows.get('a:content'))
      const permission = f.rows.get('a:permissions')!
      permission.cursor = 'permission-page-2'
      permission.retryAt = new Date('2026-09-17T00:00:00Z')
      f.list.mockRejectedValueOnce(new GoogleApiError('calendar.events.list', 403, [], false))
      await f.step(2)
      expect(f.saved()).toMatchObject({
        generationId: 'generation',
        complete: false,
        resumeAt: '2026-09-17T00:05:00.000Z',
        listingFailures: { count: 1 },
      })
      expect(permission.cursor).toBe('permission-page-2')
      const callsBeforeRetry = f.list.mock.calls.length
      f.restart()
      await f.step()
      expect(f.list).toHaveBeenCalledTimes(callsBeforeRetry)
      expect(f.saved().complete).toBe(false)
      f.advance(5 * 60_000)
      f.restart()
      await f.step(2)
      expect(f.list.mock.calls.at(-1)?.[2]).toBe('permission-page-2')
      expect(f.rows.get('a:content')).toEqual(content)
      expect(f.saved()).toMatchObject({
        generationId: 'generation',
        complete: true,
        resumeAt: null,
        listingFailures: null,
      })
      expect(permission.retryAt).toEqual(new Date('2026-09-17T12:05:00Z'))
      expect(mocks.directory).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps completed manual users complete while unfinished work and permission refresh continue', async () => {
    mocks.directory.mockResolvedValue({ users: [user('a'), user('b')] })
    const f = fixture('gmail', 0)
    await f.step(2)
    const a = f.rows.get('a:content')!
    const before = structuredClone(a)
    const b = f.rows.get('b:content')!
    b.retryAt = new Date('2026-09-18T00:00:00Z')
    f.advance(13 * 60 * 60 * 1000)
    await f.step(2)
    expect(f.rows.get('a:content')).toEqual(before)
    expect(f.process.mock.calls.at(-2)?.[2]).toMatchObject({ permissionsOnly: true })
    expect(mocks.directory).toHaveBeenCalledTimes(1)
    expect(f.saved().resumeAt).toBe('2026-09-18T00:00:00.000Z')
  })
})
