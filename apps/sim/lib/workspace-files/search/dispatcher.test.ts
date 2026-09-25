/**
 * @vitest-environment node
 */
import {
  workspaceFileSearchBackfill,
  workspaceFileSearchDispatchQueue,
  workspaceFileSearchRevision,
} from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  batchTrigger: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@sim/db/schema', async () => ({
  ...(await import('@sim/testing/mocks/schema.mock')).schemaMock,
  workspaceFileSearchBackfill: { id: 'backfill.id' },
  workspaceFileSearchDispatchQueue: {
    workspaceId: 'queue.workspaceId',
    lastDispatchedAt: 'queue.lastDispatchedAt',
    enqueuedAt: 'queue.enqueuedAt',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: mocks.info, warn: mocks.warn, error: mocks.error }),
}))
vi.mock('@/lib/workspace-files/search/index-state', () => ({
  cleanupFileSearchBuilds: vi.fn().mockResolvedValue(0),
}))
vi.mock('@trigger.dev/sdk', () => ({ tasks: { batchTrigger: mocks.batchTrigger } }))
vi.mock('@/lib/core/config/env-flags', () => ({ isTriggerDevEnabled: true }))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: async () => 'us-east-1' }))
vi.mock('@/lib/workspace-files/search/indexing', () => ({
  indexWorkspaceFileForSearch: vi.fn(),
  markWorkspaceFileSearchIndexFailed: vi.fn(),
}))

import { FILE_SEARCH_DISPATCH_HANDOFF_MS } from '@/lib/workspace-files/search/constants'
import {
  buildWorkspaceFileSearchTriggerItems,
  dispatchWorkspaceFileSearchIndexJobs,
  prepareWorkspaceFileSearchDispatch,
  shouldUseWorkspaceFileSearchTrigger,
} from '@/lib/workspace-files/search/dispatcher'

describe('workspace file search dispatch policy', () => {
  it('uses Trigger.dev from inside a task even when the deployment flag is absent', () => {
    expect(shouldUseWorkspaceFileSearchTrigger(false, true)).toBe(true)
    expect(shouldUseWorkspaceFileSearchTrigger(true, false)).toBe(true)
    expect(shouldUseWorkspaceFileSearchTrigger(false, false)).toBe(false)
  })

  it('deduplicates each immutable revision without including file contents', () => {
    const payload = {
      workspaceId: 'workspace-1',
      fileId: 'file-1',
      sourceContentUpdatedAt: '2026-08-29T12:00:00.000Z',
    }

    expect(buildWorkspaceFileSearchTriggerItems([payload], 'us-east-1')).toEqual([
      {
        payload,
        options: {
          idempotencyKey: 'workspace-file-search-v2:file-1:2026-08-29T12:00:00.000Z:initial',
          idempotencyKeyTTL: '1h',
          tags: ['workspaceId:workspace-1', 'fileId:file-1'],
          region: 'us-east-1',
        },
      },
    ])
  })
})

describe('workspace file search dispatch deadlines', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('sets local database deadlines before taking the advisory lock', async () => {
    dbChainMockFns.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ acquired: false }])

    await expect(prepareWorkspaceFileSearchDispatch()).resolves.toEqual({
      payloads: [],
      backfilledFiles: 0,
      reapedClaims: 0,
      abandonedClaims: 0,
      lockAcquired: false,
    })

    const guards = JSON.stringify(dbChainMockFns.execute.mock.calls[0][0])
    expect(guards).toContain("set_config('statement_timeout', ")
    expect(guards).toContain('10000ms')
    expect(guards).toContain("set_config('lock_timeout', ")
    expect(guards).toContain('2000ms')
    expect(guards).toContain("'transaction_timeout'")
    expect(guards).toContain('20000ms')
    expect(JSON.stringify(dbChainMockFns.execute.mock.calls[1][0])).toContain(
      'pg_try_advisory_xact_lock'
    )
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it.each(['57014', '55P03', '25P04'])(
    'propagates SQLSTATE %s without enqueuing an uncommitted claim',
    async (code) => {
      const error = new Error('Failed query\nparams: sensitive-value', {
        cause: Object.assign(new Error('database timeout'), { code }),
      })
      dbChainMockFns.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ acquired: true }])
      dbChainMockFns.onConflictDoNothing.mockRejectedValueOnce(error)

      await expect(dispatchWorkspaceFileSearchIndexJobs()).rejects.toBe(error)

      expect(mocks.batchTrigger).not.toHaveBeenCalled()
      expect(mocks.error).toHaveBeenCalledWith('Workspace file search dispatch phase failed', {
        phase: 'backfill',
        durationMs: expect.any(Number),
        code,
        error: 'Failed query',
      })
      expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('sensitive-value')
    }
  )

  it('reports a transaction failure even after the transaction callback finishes', async () => {
    const error = Object.assign(new Error('commit failed'), { code: '08006' })
    dbChainMockFns.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ acquired: false }])
    dbChainMockFns.transaction.mockImplementationOnce(async (callback) => {
      await callback(dbChainMock.db)
      throw error
    })

    await expect(prepareWorkspaceFileSearchDispatch()).rejects.toBe(error)

    expect(mocks.error).toHaveBeenCalledWith('Workspace file search dispatch phase failed', {
      phase: 'prepare-transaction',
      durationMs: expect.any(Number),
      code: '08006',
      error: 'commit failed',
    })
  })

  it('records the driver cancellation reason and preserves the original failure', async () => {
    const error = new Error('Failed query\nparams: private-content', {
      cause: Object.assign(new Error('canceling statement due to statement timeout'), {
        code: '57014',
        detail: 'private driver detail',
      }),
    })
    dbChainMockFns.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ acquired: true }])
    dbChainMockFns.onConflictDoNothing.mockRejectedValueOnce(error)

    await expect(dispatchWorkspaceFileSearchIndexJobs()).rejects.toBe(error)
    expect(mocks.error).toHaveBeenCalledWith('Workspace file search dispatch phase failed', {
      phase: 'backfill',
      durationMs: expect.any(Number),
      code: '57014',
      databaseReason: 'statement_timeout',
      error: 'Failed query',
    })
    expect(mocks.batchTrigger).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain('private')
  })

  it.each([false, true])(
    'preserves enqueue failures when claim release fails: %s',
    async (releaseFails) => {
      queueTableRows(workspaceFileSearchBackfill, [{ completedAt: new Date() }])
      queueTableRows(workspaceFileSearchRevision, [])
      queueTableRows(workspaceFileSearchDispatchQueue, [{ workspaceId: 'workspace-1' }])
      dbChainMockFns.execute
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ acquired: true }])
        .mockResolvedValueOnce([{ active: 0 }])
        .mockResolvedValueOnce([
          {
            workspaceId: 'workspace-1',
            fileId: 'file-1',
            sourceContentUpdatedAt: new Date('2026-09-16T00:00:00Z'),
          },
        ])
      const error = new Error('Trigger unavailable')
      const releaseError = new Error('claim release unavailable')
      mocks.batchTrigger.mockRejectedValueOnce(error)
      if (releaseFails) {
        dbChainMockFns.transaction
          .mockImplementationOnce(async (callback) => callback(dbChainMock.db))
          .mockRejectedValueOnce(releaseError)
      }

      if (releaseFails) {
        await expect(dispatchWorkspaceFileSearchIndexJobs()).rejects.toMatchObject({
          errors: [error, releaseError],
          cause: error,
        })
      } else {
        await expect(dispatchWorkspaceFileSearchIndexJobs()).rejects.toBe(error)
        const release = dbChainMockFns.set.mock.calls.findLastIndex(
          ([values]) => 'dispatchedAt' in values
        )
        expect(dbChainMockFns.set.mock.calls[release][0]).toMatchObject({
          dispatchedAt: null,
          handoffExpiresAt: null,
        })
        expect(dbChainMockFns.set.mock.invocationCallOrder[release]).toBeGreaterThan(
          mocks.batchTrigger.mock.invocationCallOrder[0]
        )
      }
      expect(dbChainMockFns.set).not.toHaveBeenCalledWith({ handoffExpiresAt: null })

      expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(2)
      const guards = dbChainMockFns.execute.mock.calls.filter(([query]) =>
        JSON.stringify(query).includes('statement_timeout')
      )
      expect(guards).toHaveLength(1)
    }
  )

  it('reports claims released for a lapsed handoff once the release commits', async () => {
    queueTableRows(workspaceFileSearchBackfill, [{ completedAt: new Date() }])
    queueTableRows(workspaceFileSearchRevision, [
      {
        workspaceId: 'workspace-1',
        fileId: 'file-1',
        sourceContentUpdatedAt: new Date('2026-09-16T00:00:00Z'),
        currentFileId: 'file-1',
        handoffExpired: true,
      },
      {
        workspaceId: 'workspace-1',
        fileId: 'file-2',
        sourceContentUpdatedAt: new Date('2026-09-16T00:00:00Z'),
        currentFileId: 'file-2',
        handoffExpired: false,
      },
    ])
    dbChainMockFns.execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([{ active: 100 }])

    await expect(dispatchWorkspaceFileSearchIndexJobs()).resolves.toMatchObject({
      reapedClaims: 2,
      abandonedClaims: 1,
      dispatchedFiles: 0,
    })

    expect(mocks.warn).toHaveBeenCalledWith(
      'Released workspace file search claims with no run known to exist',
      { claims: 1 }
    )
    expect(mocks.warn.mock.invocationCallOrder[0]).toBeGreaterThan(
      dbChainMockFns.transaction.mock.invocationCallOrder[0]
    )
  })

  it.each([false, true])(
    'records the handoff only after Trigger.dev accepts the runs (write fails: %s)',
    async (handoffFails) => {
      queueTableRows(workspaceFileSearchBackfill, [{ completedAt: new Date() }])
      queueTableRows(workspaceFileSearchRevision, [])
      queueTableRows(workspaceFileSearchDispatchQueue, [{ workspaceId: 'workspace-1' }])
      dbChainMockFns.execute
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ acquired: true }])
        .mockResolvedValueOnce([{ active: 0 }])
        .mockResolvedValueOnce([
          {
            workspaceId: 'workspace-1',
            fileId: 'file-1',
            sourceContentUpdatedAt: new Date('2026-09-16T00:00:00Z'),
          },
        ])
      mocks.batchTrigger.mockResolvedValueOnce({ batchId: 'batch-1' })
      if (handoffFails) {
        dbChainMockFns.set.mockImplementation((values: Record<string, unknown>) => {
          if ('handoffExpiresAt' in values && !('dispatchedAt' in values)) {
            return { where: () => Promise.reject(new Error('handoff write failed')) }
          }
          return { where: () => Promise.resolve([]) }
        })
      }

      await expect(dispatchWorkspaceFileSearchIndexJobs()).resolves.toMatchObject({
        dispatchedFiles: 1,
      })

      const claim = JSON.stringify(dbChainMockFns.execute.mock.calls[3][0])
      expect(claim).toContain('handoff_expires_at = clock_timestamp() + ')
      expect(claim).toContain(`${FILE_SEARCH_DISPATCH_HANDOFF_MS}`)
      const handoff = dbChainMockFns.set.mock.calls.findIndex(
        ([values]) => JSON.stringify(values) === JSON.stringify({ handoffExpiresAt: null })
      )
      expect(handoff).toBeGreaterThanOrEqual(0)
      expect(mocks.batchTrigger.mock.invocationCallOrder[0]).toBeLessThan(
        dbChainMockFns.set.mock.invocationCallOrder[handoff]
      )
      expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(2)
      expect(mocks.info).not.toHaveBeenCalledWith('Workspace file search dispatch phase started', {
        phase: 'release-claims',
      })
      if (handoffFails) {
        expect(mocks.error).toHaveBeenCalledWith(
          'Workspace file search dispatch phase failed',
          expect.objectContaining({ phase: 'handoff', error: 'handoff write failed' })
        )
      }
    }
  )
})
