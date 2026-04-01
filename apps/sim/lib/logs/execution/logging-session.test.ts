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
    sql,
  }
})

const { completeWorkflowExecutionMock } = vi.hoisted(() => ({
  completeWorkflowExecutionMock: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: dbMocks.select,
    update: dbMocks.update,
    execute: dbMocks.execute,
  },
}))

vi.mock('@sim/db/schema', () => ({
  workflowExecutionLogs: {},
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('drizzle-orm', () => ({
  eq: dbMocks.eq,
  sql: dbMocks.sql,
}))

vi.mock('@/lib/logs/execution/logger', () => ({
  executionLogger: {
    startWorkflowExecution: vi.fn(),
    completeWorkflowExecution: completeWorkflowExecutionMock,
  },
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
    modelCost: 0,
    models: {},
  }),
  createEnvironmentObject: vi.fn(),
  createTriggerObject: vi.fn(),
  loadDeployedWorkflowStateForLogging: vi.fn(),
  loadWorkflowStateForExecution: vi.fn(),
}))

import { LoggingSession } from './logging-session'

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

  it('preserves accumulated cost during fallback completion', async () => {
    const session = new LoggingSession('workflow-1', 'execution-6', 'api', 'req-1') as any

    session.accumulatedCost = {
      total: 12,
      input: 5,
      output: 7,
      tokens: { input: 11, output: 13, total: 24 },
      models: {
        'test-model': {
          input: 5,
          output: 7,
          total: 12,
          tokens: { input: 11, output: 13, total: 24 },
        },
      },
    }
    session.costFlushed = true

    completeWorkflowExecutionMock
      .mockRejectedValueOnce(new Error('success finalize failed'))
      .mockResolvedValueOnce({})

    await expect(session.safeComplete({ finalOutput: { ok: true } })).resolves.toBeUndefined()

    expect(completeWorkflowExecutionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        executionId: 'execution-6',
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

  it('drains fire-and-forget cost flushes before terminal completion', async () => {
    let releaseFlush: (() => void) | undefined
    const flushPromise = new Promise<void>((resolve) => {
      releaseFlush = resolve
    })

    const session = new LoggingSession('workflow-1', 'execution-1', 'api', 'req-1') as any
    session.flushAccumulatedCost = vi.fn(() => flushPromise)
    session.complete = vi.fn().mockResolvedValue(undefined)

    await session.onBlockComplete('block-2', 'Transform', 'function', {
      endedAt: '2025-01-01T00:00:01.000Z',
      output: {
        value: true,
        cost: { total: 1, input: 1, output: 0 },
        tokens: { input: 1, output: 0, total: 1 },
        model: 'test-model',
      },
    })

    const completionPromise = session.safeComplete({ finalOutput: { ok: true } })

    await Promise.resolve()

    expect(session.complete).not.toHaveBeenCalled()

    releaseFlush?.()

    await completionPromise

    expect(session.flushAccumulatedCost).toHaveBeenCalledTimes(1)
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
