import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMocks = vi.hoisted(() => {
  const selectLimit = vi.fn()
  const selectWhere = vi.fn()
  const selectFrom = vi.fn()
  const select = vi.fn()
  const updateWhere = vi.fn()
  const updateSet = vi.fn()
  const update = vi.fn()
  const execute = vi.fn()
  const eq = vi.fn()
  const and = vi.fn((...args: unknown[]) => ({ type: 'and', args }))
  const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }))

  select.mockReturnValue({ from: selectFrom })
  selectFrom.mockReturnValue({ where: selectWhere })
  selectWhere.mockReturnValue({ limit: selectLimit })

  update.mockReturnValue({ set: updateSet })
  updateSet.mockReturnValue({ where: updateWhere })

  return {
    select,
    selectFrom,
    selectWhere,
    selectLimit,
    update,
    updateSet,
    updateWhere,
    execute,
    eq,
    and,
    sql,
  }
})

const {
  completeWorkflowExecutionMock,
  startWorkflowExecutionMock,
  loadWorkflowStateForExecutionMock,
  releaseExecutionSlotMock,
} = vi.hoisted(() => ({
  completeWorkflowExecutionMock: vi.fn(),
  startWorkflowExecutionMock: vi.fn(),
  loadWorkflowStateForExecutionMock: vi.fn(),
  releaseExecutionSlotMock: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: dbMocks.select,
    update: dbMocks.update,
    execute: dbMocks.execute,
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: dbMocks.eq,
  and: dbMocks.and,
  sql: dbMocks.sql,
}))

vi.mock('@/lib/logs/execution/logger', () => ({
  executionLogger: {
    startWorkflowExecution: startWorkflowExecutionMock,
    completeWorkflowExecution: completeWorkflowExecutionMock,
  },
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: releaseExecutionSlotMock,
}))

const {
  setLastStartedBlockMock,
  setLastCompletedBlockMock,
  getProgressMarkersMock,
  clearProgressMarkersMock,
} = vi.hoisted(() => ({
  setLastStartedBlockMock: vi.fn().mockResolvedValue(false),
  setLastCompletedBlockMock: vi.fn().mockResolvedValue(false),
  getProgressMarkersMock: vi.fn().mockResolvedValue({}),
  clearProgressMarkersMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/logs/execution/progress-markers', () => ({
  setLastStartedBlock: setLastStartedBlockMock,
  setLastCompletedBlock: setLastCompletedBlockMock,
  getProgressMarkers: getProgressMarkersMock,
  clearProgressMarkers: clearProgressMarkersMock,
}))

vi.mock('@/lib/logs/execution/logging-factory', () => ({
  calculateCostSummary: vi.fn().mockReturnValue({
    totalCost: 0,
    totalInputCost: 0,
    totalOutputCost: 0,
    totalTokens: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    baseExecutionCharge: 0,
    models: {},
  }),
  createEnvironmentObject: vi.fn(),
  createTriggerObject: vi.fn(),
  loadDeployedWorkflowStateForLogging: vi.fn(),
  loadWorkflowStateForExecution: loadWorkflowStateForExecutionMock,
}))

import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { LoggingSession } from './logging-session'

describe('LoggingSession start snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    startWorkflowExecutionMock.mockResolvedValue({})
    loadWorkflowStateForExecutionMock.mockResolvedValue({
      blocks: {
        stale: {
          id: 'stale',
          type: 'function',
          name: 'Stale',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })
  })

  it('prefers the explicit actor over a legacy session user', async () => {
    const session = new LoggingSession('workflow-1', 'execution-actor', 'api', 'req-actor')

    await session.start({
      userId: 'legacy-session-user',
      actorUserId: 'authenticated-actor',
      workspaceId: 'workspace-1',
    })

    expect(startWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'authenticated-actor' })
    )
  })

  it('does not create a log when hydrating a persisted execution for completion', async () => {
    const session = new LoggingSession('workflow-1', 'execution-existing', 'manual', 'req-existing')

    await session.start({
      userId: 'user-1',
      actorUserId: 'user-1',
      billingAttribution: {
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        organizationId: 'org-1',
        billedAccountUserId: 'owner-1',
        billingEntity: { type: 'organization', id: 'org-1' },
        billingPeriod: {
          start: '2026-07-01T00:00:00.000Z',
          end: '2026-08-01T00:00:00.000Z',
        },
        payerSubscription: null,
      },
      workspaceId: 'workspace-1',
      skipLogCreation: true,
    })

    expect(startWorkflowExecutionMock).not.toHaveBeenCalled()
  })

  it('uses the executed workflow state override for execution snapshots', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'manual', 'req-1')
    const executedWorkflowState = {
      blocks: {
        loop: {
          id: 'loop',
          type: 'loop',
          name: 'Loop',
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        },
        parallel: {
          id: 'parallel',
          type: 'parallel',
          name: 'Parallel',
          position: { x: 100, y: 80 },
          subBlocks: {},
          outputs: {},
          enabled: true,
          data: { parentId: 'loop', extent: 'parent' as const },
        },
      },
      edges: [],
      loops: { loop: { id: 'loop', nodes: ['parallel'], iterations: 1, loopType: 'for' as const } },
      parallels: { parallel: { id: 'parallel', nodes: [], count: 1 } },
    }

    await session.start({
      workspaceId: 'workspace-1',
      workflowState: executedWorkflowState,
    })

    expect(loadWorkflowStateForExecutionMock).not.toHaveBeenCalled()
    expect(startWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowState: executedWorkflowState,
      })
    )
  })
})

describe('LoggingSession completion retries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMocks.selectLimit.mockResolvedValue([{ executionData: {} }])
    dbMocks.updateWhere.mockResolvedValue(undefined)
    dbMocks.execute.mockResolvedValue(undefined)
  })

  it('keeps completion best-effort when a later error completion retries after full completion and fallback both fail', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    completeWorkflowExecutionMock
      .mockRejectedValueOnce(new Error('success finalize failed'))
      .mockRejectedValueOnce(new Error('cost only failed'))
      .mockResolvedValueOnce({})

    await expect(session.safeComplete({ finalOutput: { ok: true } })).resolves.toBeUndefined()

    await expect(
      session.safeCompleteWithError({
        error: { message: 'fallback error finalize' },
      })
    ).resolves.toBeUndefined()

    expect(completeWorkflowExecutionMock).toHaveBeenCalledTimes(3)
    expect(session.hasCompleted()).toBe(true)
  })

  it('reuses the settled completion promise for repeated completion attempts', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    completeWorkflowExecutionMock
      .mockRejectedValueOnce(new Error('success finalize failed'))
      .mockRejectedValueOnce(new Error('cost only failed'))

    await expect(session.safeComplete({ finalOutput: { ok: true } })).resolves.toBeUndefined()
    await expect(session.safeComplete({ finalOutput: { ok: true } })).resolves.toBeUndefined()

    expect(completeWorkflowExecutionMock).toHaveBeenCalledTimes(2)
  })

  it('starts a new error completion attempt after a non-error completion and fallback both fail', async () => {
    const session = new LoggingSession('workflow-1', 'execution-3', 'api', 'req-1')

    completeWorkflowExecutionMock
      .mockRejectedValueOnce(new Error('success finalize failed'))
      .mockRejectedValueOnce(new Error('cost only failed'))
      .mockResolvedValueOnce({})

    await expect(session.safeComplete({ finalOutput: { ok: true } })).resolves.toBeUndefined()

    await expect(
      session.safeCompleteWithError({
        error: { message: 'late error finalize' },
      })
    ).resolves.toBeUndefined()

    expect(completeWorkflowExecutionMock).toHaveBeenCalledTimes(3)
    expect(completeWorkflowExecutionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        executionId: 'execution-3',
        finalOutput: { error: 'late error finalize' },
      })
    )
    expect(session.hasCompleted()).toBe(true)
  })

  it('preserves successful final output during fallback completion', async () => {
    const session = new LoggingSession('workflow-1', 'execution-5', 'api', 'req-1')

    completeWorkflowExecutionMock
      .mockRejectedValueOnce(new Error('success finalize failed'))
      .mockResolvedValueOnce({})

    await expect(
      session.safeComplete({ finalOutput: { ok: true, stage: 'done' } })
    ).resolves.toBeUndefined()

    expect(completeWorkflowExecutionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        executionId: 'execution-5',
        finalOutput: { ok: true, stage: 'done' },
        finalizationPath: 'fallback_completed',
      })
    )
  })

  it('derives fallback cost from trace spans when the primary completion fails', async () => {
    const session = new LoggingSession('workflow-1', 'execution-6', 'api', 'req-1') as any

    // Resume-accumulation is retired: the cost-only fallback now derives its
    // cost summary from the in-memory trace spans (billing itself reconciles
    // from the usage_log ledger in recordExecutionUsage). The primary complete()
    // path consumes one calculateCostSummary call before it fails, so queue the
    // same value twice (primary attempt + fallback).
    const spanCostSummary = {
      totalCost: 12,
      totalInputCost: 5,
      totalOutputCost: 7,
      totalTokens: 24,
      totalPromptTokens: 11,
      totalCompletionTokens: 13,
      baseExecutionCharge: 0,
      models: {},
      charges: {},
    }
    vi.mocked(calculateCostSummary)
      .mockReturnValueOnce(spanCostSummary)
      .mockReturnValueOnce(spanCostSummary)

    completeWorkflowExecutionMock
      .mockRejectedValueOnce(new Error('success finalize failed'))
      .mockResolvedValueOnce({})

    const traceSpans = [
      {
        id: 'span-1',
        name: 'Block A',
        type: 'tool',
        duration: 25,
        startTime: '2026-03-13T10:00:00.000Z',
        endTime: '2026-03-13T10:00:00.025Z',
        status: 'success',
      },
    ] as any

    await expect(
      session.safeComplete({ finalOutput: { ok: true }, traceSpans })
    ).resolves.toBeUndefined()

    expect(calculateCostSummary).toHaveBeenLastCalledWith(traceSpans)
    expect(completeWorkflowExecutionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        executionId: 'execution-6',
        finalizationPath: 'fallback_completed',
        costSummary: expect.objectContaining({
          totalCost: 12,
          totalInputCost: 5,
          totalOutputCost: 7,
          totalTokens: 24,
        }),
      })
    )
  })

  it('persists failed error semantics when completeWithError receives non-error trace spans', async () => {
    const session = new LoggingSession('workflow-1', 'execution-4', 'api', 'req-1')
    const traceSpans = [
      {
        id: 'span-1',
        name: 'Block A',
        type: 'tool',
        duration: 25,
        startTime: '2026-03-13T10:00:00.000Z',
        endTime: '2026-03-13T10:00:00.025Z',
        status: 'success',
      },
    ]

    completeWorkflowExecutionMock.mockResolvedValue({})

    await expect(
      session.safeCompleteWithError({
        error: { message: 'persist me as failed' },
        traceSpans,
      })
    ).resolves.toBeUndefined()

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'execution-4',
        finalOutput: { error: 'persist me as failed' },
        traceSpans,
        level: 'error',
        status: 'failed',
        finalizationPath: 'force_failed',
        completionFailure: 'persist me as failed',
      })
    )
  })

  it('marks paused completions as completed and deduplicates later attempts', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    completeWorkflowExecutionMock.mockResolvedValue({})

    await expect(
      session.safeCompleteWithPause({
        endedAt: new Date().toISOString(),
        totalDurationMs: 10,
        traceSpans: [],
        workflowInput: { hello: 'world' },
      })
    ).resolves.toBeUndefined()

    expect(session.hasCompleted()).toBe(true)

    await expect(
      session.safeCompleteWithError({
        error: { message: 'should be ignored' },
      })
    ).resolves.toBeUndefined()

    expect(completeWorkflowExecutionMock).toHaveBeenCalledTimes(1)
  })

  it('releases success, failure, and cancellation but defers paused release', async () => {
    completeWorkflowExecutionMock.mockResolvedValue({})

    const completed = new LoggingSession('workflow-1', 'execution-complete', 'api', 'req-1')
    const failed = new LoggingSession('workflow-1', 'execution-failed', 'api', 'req-1')
    const cancelled = new LoggingSession('workflow-1', 'execution-cancelled', 'api', 'req-1')
    const paused = new LoggingSession('workflow-1', 'execution-paused', 'api', 'req-1')

    await completed.safeComplete()
    await failed.safeCompleteWithError({ error: { message: 'failed' } })
    await cancelled.safeCompleteWithCancellation()
    await paused.safeCompleteWithPause()

    expect(releaseExecutionSlotMock.mock.calls.map(([executionId]) => executionId)).toEqual([
      'execution-complete',
      'execution-failed',
      'execution-cancelled',
    ])
  })

  it('releases the attempt reservation while finalizing the parent execution log', async () => {
    completeWorkflowExecutionMock.mockResolvedValue({})
    const session = new LoggingSession(
      'workflow-1',
      'parent-execution-1',
      'manual',
      'req-1',
      'resume-entry-1'
    )

    await session.safeComplete()

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'parent-execution-1' })
    )
    expect(releaseExecutionSlotMock).toHaveBeenCalledWith('resume-entry-1')
  })

  it('falls back to cost-only logging when paused completion fails', async () => {
    const session = new LoggingSession('workflow-1', 'execution-2', 'api', 'req-1')

    completeWorkflowExecutionMock
      .mockRejectedValueOnce(new Error('pause finalize failed'))
      .mockResolvedValueOnce({})

    await expect(
      session.safeCompleteWithPause({
        endedAt: new Date().toISOString(),
        totalDurationMs: 10,
        traceSpans: [],
        workflowInput: { hello: 'world' },
      })
    ).resolves.toBeUndefined()

    expect(session.hasCompleted()).toBe(true)
    expect(completeWorkflowExecutionMock).toHaveBeenCalledTimes(2)
  })

  it('persists last started block independently from cost accumulation', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.onBlockStart('block-1', 'Fetch', 'api', '2025-01-01T00:00:00.000Z')

    expect(dbMocks.select).not.toHaveBeenCalled()
    expect(dbMocks.execute).toHaveBeenCalledTimes(1)
  })

  it('enforces started marker monotonicity in the database write path', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.onBlockStart('block-1', 'Fetch', 'api', '2025-01-01T00:00:00.000Z')

    expect(dbMocks.sql).toHaveBeenCalled()
    expect(dbMocks.execute).toHaveBeenCalledTimes(1)
  })

  it('allows same-millisecond started markers to replace the prior marker', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.onBlockStart('block-1', 'Fetch', 'api', '2025-01-01T00:00:00.000Z')

    const queryCall = dbMocks.sql.mock.calls.at(-1)
    expect(queryCall).toBeDefined()

    const [query] = queryCall!
    expect(Array.from(query).join(' ')).toContain('<=')
  })

  it('persists last completed block for zero-cost outputs', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.onBlockComplete('block-2', 'Transform', 'function', {
      endedAt: '2025-01-01T00:00:01.000Z',
      output: { value: true },
    })

    expect(dbMocks.select).not.toHaveBeenCalled()
    expect(dbMocks.execute).toHaveBeenCalledTimes(1)
  })

  it('allows same-millisecond completed markers to replace the prior marker', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.onBlockComplete('block-2', 'Transform', 'function', {
      endedAt: '2025-01-01T00:00:01.000Z',
      output: { value: true },
    })

    const queryCall = dbMocks.sql.mock.calls.at(-1)
    expect(queryCall).toBeDefined()

    const [query] = queryCall!
    expect(Array.from(query).join(' ')).toContain('<=')
  })

  it('drains pending lifecycle writes before terminal completion', async () => {
    let releasePersist: (() => void) | undefined
    const persistPromise = new Promise<void>((resolve) => {
      releasePersist = resolve
    })

    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1') as any
    session.persistLastStartedBlock = vi.fn(() => persistPromise)
    session.complete = vi.fn().mockResolvedValue(undefined)

    const startPromise = session.onBlockStart('block-1', 'Fetch', 'api', '2025-01-01T00:00:00.000Z')
    const completionPromise = session.safeComplete({ finalOutput: { ok: true } })

    await Promise.resolve()

    expect(session.complete).not.toHaveBeenCalled()

    releasePersist?.()

    await startPromise
    await completionPromise

    expect(session.persistLastStartedBlock).toHaveBeenCalledTimes(1)
    expect(session.complete).toHaveBeenCalledTimes(1)
  })

  it('drains fire-and-forget block-complete marker writes before terminal completion', async () => {
    let releasePersist: (() => void) | undefined
    const persistPromise = new Promise<void>((resolve) => {
      releasePersist = resolve
    })

    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1') as any
    session.persistLastCompletedBlock = vi.fn(() => persistPromise)
    session.complete = vi.fn().mockResolvedValue(undefined)

    // onBlockComplete is now marker-only; its marker write is fire-and-forget
    // but tracked, so terminal completion must drain it first.
    void session.onBlockComplete('block-2', 'Transform', 'function', {
      endedAt: '2025-01-01T00:00:01.000Z',
      output: { value: true },
    })

    const completionPromise = session.safeComplete({ finalOutput: { ok: true } })

    await Promise.resolve()

    expect(session.complete).not.toHaveBeenCalled()

    releasePersist?.()

    await completionPromise

    expect(session.persistLastCompletedBlock).toHaveBeenCalledTimes(1)
    expect(session.complete).toHaveBeenCalledTimes(1)
  })

  it('keeps draining when new progress writes arrive during drain', async () => {
    let releaseFirst: (() => void) | undefined
    let releaseSecond: (() => void) | undefined
    const firstPromise = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const secondPromise = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })

    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1') as any

    void session.trackProgressWrite(firstPromise)

    const drainPromise = session.drainPendingProgressWrites()

    await Promise.resolve()

    void session.trackProgressWrite(secondPromise)
    releaseFirst?.()

    await Promise.resolve()

    let drained = false
    void drainPromise.then(() => {
      drained = true
    })

    await Promise.resolve()
    expect(drained).toBe(false)

    releaseSecond?.()
    await drainPromise

    expect(session.pendingProgressWrites.size).toBe(0)
  })

  it('marks pause completion as terminal and prevents duplicate pause finalization', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1') as any
    session.completeExecutionWithFinalization = vi.fn().mockResolvedValue(undefined)

    await session.completeWithPause({ workflowInput: { ok: true } })
    await session.completeWithPause({ workflowInput: { ok: true } })

    expect(session.completeExecutionWithFinalization).toHaveBeenCalledTimes(1)
    expect(session.completed).toBe(true)
    expect(session.completing).toBe(true)
  })
})

describe('completeWithError cancelled-status guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMocks.updateWhere.mockResolvedValue(undefined)
    dbMocks.execute.mockResolvedValue(undefined)
  })

  it('skips writing failed and marks session complete when DB status is already cancelled', async () => {
    dbMocks.selectLimit.mockResolvedValue([{ status: 'cancelled' }])
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.safeCompleteWithError({ error: { message: 'block errored mid-cancel' } })

    expect(completeWorkflowExecutionMock).not.toHaveBeenCalled()
    expect(session.hasCompleted()).toBe(true)
  })

  it('writes failed when DB status is running (no cancel in flight)', async () => {
    dbMocks.selectLimit.mockResolvedValue([{ status: 'running' }])
    completeWorkflowExecutionMock.mockResolvedValue({})
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.safeCompleteWithError({ error: { message: 'genuine block failure' } })

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    )
    expect(session.hasCompleted()).toBe(true)
  })

  it('writes failed when no execution log exists yet', async () => {
    dbMocks.selectLimit.mockResolvedValue([])
    completeWorkflowExecutionMock.mockResolvedValue({})
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.safeCompleteWithError({ error: { message: 'pre-log error' } })

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    )
  })

  it('deduplicates all subsequent completion attempts after guard early-return', async () => {
    dbMocks.selectLimit.mockResolvedValue([{ status: 'cancelled' }])
    completeWorkflowExecutionMock.mockResolvedValue({})
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.safeCompleteWithError({ error: { message: 'error 1' } })
    await session.safeCompleteWithError({ error: { message: 'error 2' } })
    await session.safeComplete({ finalOutput: { ok: true } })

    expect(completeWorkflowExecutionMock).not.toHaveBeenCalled()
    expect(session.hasCompleted()).toBe(true)
  })

  it('falls through to cost-only fallback when the DB check itself throws', async () => {
    dbMocks.selectLimit.mockRejectedValueOnce(new Error('DB connection lost'))
    completeWorkflowExecutionMock.mockResolvedValue({})
    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1')

    await session.safeCompleteWithError({ error: { message: 'block failed' } })

    expect(completeWorkflowExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({ finalizationPath: 'force_failed' })
    )
    expect(session.hasCompleted()).toBe(true)
  })
})

describe('LoggingSession.markExecutionAsFailed workflowId scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMocks.updateWhere.mockResolvedValue(undefined)
  })

  it('scopes UPDATE by both executionId and workflowId', async () => {
    await LoggingSession.markExecutionAsFailed('exec-1', undefined, undefined, 'wf-1')

    expect(dbMocks.update).toHaveBeenCalledTimes(1)
    expect(dbMocks.updateSet).toHaveBeenCalledTimes(1)
    expect(dbMocks.updateWhere).toHaveBeenCalledTimes(1)

    const whereArgs = dbMocks.updateWhere.mock.calls[0]
    expect(whereArgs).toBeDefined()
  })

  it('instance markAsFailed forwards workflowId to the static method', async () => {
    const updateWhereSpy = dbMocks.updateWhere
    dbMocks.selectLimit.mockResolvedValue([{ executionData: {} }])

    const session = new LoggingSession('wf-42', 'exec-42', 'api', 'req-1')
    await session.markAsFailed('something went wrong')

    expect(updateWhereSpy).toHaveBeenCalledTimes(1)
    expect(releaseExecutionSlotMock).toHaveBeenCalledWith('exec-42')
  })

  it('uses the provided errorMessage in the SQL set', async () => {
    const sqlMock = dbMocks.sql
    await LoggingSession.markExecutionAsFailed('exec-2', 'custom error', undefined, 'wf-2')

    expect(sqlMock).toHaveBeenCalled()
    const lastCall = sqlMock.mock.calls.at(-1)!
    const [strings, ...values] = lastCall
    const combined = String(Array.from(strings)).toLowerCase() + values.join(' ').toLowerCase()
    expect(combined).toContain('force_failed')
  })

  it('clears Redis markers when marking failed (terminal boundary outside completeWorkflowExecution)', async () => {
    await LoggingSession.markExecutionAsFailed('exec-3', 'boom', undefined, 'wf-3')
    expect(clearProgressMarkersMock).toHaveBeenCalledWith('exec-3')
  })

  it('folds live Redis markers into the row before clearing on force-fail', async () => {
    getProgressMarkersMock.mockResolvedValueOnce({
      lastStartedBlock: { blockId: 'b1', blockName: 'Fetch', blockType: 'api', startedAt: 't1' },
      lastCompletedBlock: {
        blockId: 'b1',
        blockName: 'Fetch',
        blockType: 'api',
        endedAt: 't2',
        success: false,
      },
    })

    await LoggingSession.markExecutionAsFailed('exec-9', 'boom', undefined, 'wf-9')

    const folded = dbMocks.sql.mock.calls
      .map((c) => String(Array.from(c[0] as TemplateStringsArray)))
      .join(' ')
    expect(folded).toContain('lastStartedBlock')
    expect(folded).toContain('lastCompletedBlock')
    expect(clearProgressMarkersMock).toHaveBeenCalledWith('exec-9')
  })

  it('does not clear markers when the Redis read fails (avoids wiping the only copy)', async () => {
    getProgressMarkersMock.mockResolvedValueOnce(null)
    await LoggingSession.markExecutionAsFailed('exec-readfail', 'boom', undefined, 'wf-x')
    expect(clearProgressMarkersMock).not.toHaveBeenCalled()
  })
})

describe('LoggingSession progress-marker write path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    startWorkflowExecutionMock.mockResolvedValue({})
    loadWorkflowStateForExecutionMock.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
    })
    dbMocks.execute.mockResolvedValue(undefined)
  })

  it('writes markers to Redis (not the row) when Redis accepts the write', async () => {
    setLastStartedBlockMock.mockResolvedValue(true)
    setLastCompletedBlockMock.mockResolvedValue(true)
    const session = new LoggingSession('wf-1', 'exec-redis', 'manual', 'req-1')
    await session.start({ workspaceId: 'ws-1' })

    await session.onBlockStart('b1', 'Fetch', 'api', '2026-06-27T10:00:00.000Z')
    await session.onBlockComplete('b1', 'Fetch', 'api', { endedAt: '2026-06-27T10:00:01.000Z' })

    expect(setLastStartedBlockMock).toHaveBeenCalledWith(
      'exec-redis',
      expect.objectContaining({ blockId: 'b1', startedAt: '2026-06-27T10:00:00.000Z' })
    )
    expect(setLastCompletedBlockMock).toHaveBeenCalledWith(
      'exec-redis',
      expect.objectContaining({ blockId: 'b1', success: true })
    )
    expect(dbMocks.execute).not.toHaveBeenCalled()
  })

  it('falls back to the SQL UPDATE when the Redis write fails', async () => {
    setLastStartedBlockMock.mockResolvedValue(false)
    const session = new LoggingSession('wf-1', 'exec-redis-down', 'manual', 'req-1')
    await session.start({ workspaceId: 'ws-1' })

    await session.onBlockStart('b1', 'Fetch', 'api', '2026-06-27T10:00:00.000Z')

    expect(setLastStartedBlockMock).toHaveBeenCalled()
    expect(dbMocks.execute).toHaveBeenCalledTimes(1)
  })
})
