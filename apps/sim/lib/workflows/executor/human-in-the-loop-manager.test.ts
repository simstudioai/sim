/**
 * @vitest-environment node
 *
 * Tests for the pause-resume race condition fix in PauseResumeManager.
 * Verifies that enqueueOrStartResume retries with exponential backoff
 * when the paused execution record has not yet been persisted.
 */
import { loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@sim/db', () => ({
  db: {
    transaction: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@sim/db/schema', () => ({
  pausedExecutions: {
    executionId: 'executionId',
    id: 'id',
  },
  resumeQueue: {
    id: 'id',
    parentExecutionId: 'parentExecutionId',
    status: 'status',
    queuedAt: 'queuedAt',
  },
  workflowExecutionLogs: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((col: unknown) => col),
  desc: vi.fn((col: unknown) => col),
  inArray: vi.fn((...args: unknown[]) => args),
  lt: vi.fn((...args: unknown[]) => args),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}))

vi.mock('@/lib/core/execution-limits', () => ({
  createTimeoutAbortController: vi.fn(),
  getTimeoutErrorMessage: vi.fn(),
}))

vi.mock('@/lib/execution/preprocessing', () => ({
  preprocessExecution: vi.fn(),
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn(),
}))

vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: vi.fn(),
}))

vi.mock('@/executor/execution/snapshot', () => ({
  ExecutionSnapshot: vi.fn(),
}))

vi.mock('@/executor/utils/output-filter', () => ({
  filterOutputForLog: vi.fn(),
}))

import { db } from '@sim/db'
import { PauseResumeManager } from './human-in-the-loop-manager'

describe('PauseResumeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * Creates a mock transaction object that simulates Drizzle query chains.
   * The pausedExecution lookup uses: select().from().where().for('update').limit(1).then()
   * The activeResume lookup uses: select({id}).from().where().limit(1).then()
   */
  function createMockTx(pausedExecution: Record<string, unknown> | null) {
    // Build a reusable terminal chain that resolves to []
    const emptyTerminal = () => ({
      limit: vi.fn().mockReturnValue({
        then: vi
          .fn()
          .mockImplementation((resolve: (rows: unknown[]) => unknown) => resolve([])),
      }),
      then: vi
        .fn()
        .mockImplementation((resolve: (rows: unknown[]) => unknown) => resolve([])),
    })

    // The first select() call is the pausedExecution lookup (with .for('update'))
    // The second select() call is the activeResume check (no .for())
    let selectCallCount = 0

    return {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++
        const isFirstSelect = selectCallCount === 1

        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              // .for('update') path — pausedExecution lookup
              for: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  then: vi.fn().mockImplementation(
                    (resolve: (rows: unknown[]) => unknown) =>
                      resolve(isFirstSelect && pausedExecution ? [pausedExecution] : [])
                  ),
                }),
              }),
              // .limit() path (no .for()) — activeResume lookup
              limit: vi.fn().mockReturnValue({
                then: vi.fn().mockImplementation(
                  (resolve: (rows: unknown[]) => unknown) => resolve([])
                ),
              }),
              // Direct .then() path
              then: vi.fn().mockImplementation(
                (resolve: (rows: unknown[]) => unknown) => resolve([])
              ),
            }),
          }),
        }
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'rq-1', queuedAt: new Date() }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }
  }

  function createValidPausedExecution() {
    return {
      id: 'pe-1',
      executionId: 'exec-1',
      workflowId: 'wf-1',
      pausePoints: {
        'ctx-1': {
          contextId: 'ctx-1',
          blockId: 'block-1',
          resumeStatus: 'paused',
          snapshotReady: true,
        },
      },
    }
  }

  describe('enqueueOrStartResume - retry on race condition', () => {
    it('should retry when paused execution is not found and succeed on later attempt', async () => {
      let callCount = 0
      const mockedTransaction = vi.mocked(db.transaction)

      mockedTransaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          callCount++
          if (callCount <= 2) {
            return callback(createMockTx(null))
          }
          return callback(createMockTx(createValidPausedExecution()))
        }
      )

      const resultPromise = PauseResumeManager.enqueueOrStartResume({
        executionId: 'exec-1',
        contextId: 'ctx-1',
        resumeInput: { value: 'test' },
        userId: 'user-1',
      })

      // Advance timers for retry delays (50ms, 100ms)
      await vi.advanceTimersByTimeAsync(50)
      await vi.advanceTimersByTimeAsync(100)

      const result = await resultPromise

      // Should have retried: 2 failures + 1 success = 3 calls
      expect(callCount).toBe(3)
      expect(result.status).toBe('starting')
      expect(result.resumeExecutionId).toBe('exec-1')
    })

    it('should throw after exhausting all retry attempts', async () => {
      const mockedTransaction = vi.mocked(db.transaction)

      // All attempts fail — pause record never appears
      mockedTransaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          return callback(createMockTx(null))
        }
      )

      // Capture the rejection to prevent unhandled rejection warnings
      let caughtError: Error | undefined
      const resultPromise = PauseResumeManager.enqueueOrStartResume({
        executionId: 'exec-1',
        contextId: 'ctx-1',
        resumeInput: {},
        userId: 'user-1',
      }).catch((err: Error) => {
        caughtError = err
      })

      // Advance timers for all retry delays: 50, 100, 200, 400ms
      await vi.advanceTimersByTimeAsync(800)
      await resultPromise

      expect(caughtError).toBeDefined()
      expect(caughtError!.message).toBe('Paused execution not found or already resumed')
    })

    it('should not retry for non-race-condition errors', async () => {
      let callCount = 0
      const mockedTransaction = vi.mocked(db.transaction)

      const alreadyResumedExecution = {
        ...createValidPausedExecution(),
        pausePoints: {
          'ctx-1': {
            contextId: 'ctx-1',
            blockId: 'block-1',
            resumeStatus: 'resumed', // Already resumed
            snapshotReady: true,
          },
        },
      }

      mockedTransaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          callCount++
          return callback(createMockTx(alreadyResumedExecution))
        }
      )

      await expect(
        PauseResumeManager.enqueueOrStartResume({
          executionId: 'exec-1',
          contextId: 'ctx-1',
          resumeInput: {},
          userId: 'user-1',
        })
      ).rejects.toThrow('Pause point already resumed or in progress')

      // Should NOT retry — this is a different error
      expect(callCount).toBe(1)
    })

    it('should succeed immediately when paused execution exists on first try', async () => {
      let callCount = 0
      const mockedTransaction = vi.mocked(db.transaction)

      mockedTransaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          callCount++
          return callback(createMockTx(createValidPausedExecution()))
        }
      )

      const result = await PauseResumeManager.enqueueOrStartResume({
        executionId: 'exec-1',
        contextId: 'ctx-1',
        resumeInput: { value: 'test' },
        userId: 'user-1',
      })

      // No retries needed
      expect(callCount).toBe(1)
      expect(result.status).toBe('starting')
    })
  })
})
