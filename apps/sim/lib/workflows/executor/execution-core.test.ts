import {
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getPersonalAndWorkspaceEnvMock,
  mergeSubblockStateWithValuesMock,
  safeStartMock,
  safeCompleteMock,
  safeCompleteWithErrorMock,
  safeCompleteWithCancellationMock,
  safeCompleteWithPauseMock,
  hasCompletedMock,
  clearExecutionCancellationMock,
  buildTraceSpansMock,
  serializeWorkflowMock,
  executorExecuteMock,
  onBlockStartPersistenceMock,
  executorConstructorMock,
  findStartBlockMock,
} = vi.hoisted(() => ({
  getPersonalAndWorkspaceEnvMock: vi.fn(),
  mergeSubblockStateWithValuesMock: vi.fn(),
  safeStartMock: vi.fn(),
  safeCompleteMock: vi.fn(),
  safeCompleteWithErrorMock: vi.fn(),
  safeCompleteWithCancellationMock: vi.fn(),
  safeCompleteWithPauseMock: vi.fn(),
  hasCompletedMock: vi.fn(),
  clearExecutionCancellationMock: vi.fn(),
  buildTraceSpansMock: vi.fn(),
  serializeWorkflowMock: vi.fn(),
  executorExecuteMock: vi.fn(),
  onBlockStartPersistenceMock: vi.fn(),
  executorConstructorMock: vi.fn(),
  findStartBlockMock: vi.fn(),
}))

const loadWorkflowFromNormalizedTablesMock =
  workflowsPersistenceUtilsMockFns.mockLoadWorkflowFromNormalizedTables
const loadDeployedWorkflowStateMock = workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState
const updateWorkflowRunCountsMock = workflowsUtilsMockFns.mockUpdateWorkflowRunCounts

vi.mock('@/lib/environment/utils', () => ({
  getPersonalAndWorkspaceEnv: getPersonalAndWorkspaceEnvMock,
}))

vi.mock('@/lib/execution/cancellation', () => ({
  clearExecutionCancellation: clearExecutionCancellationMock,
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: buildTraceSpansMock,
}))

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/workflows/subblocks', () => ({
  mergeSubblockStateWithValues: mergeSubblockStateWithValuesMock,
}))

vi.mock('@/lib/workflows/triggers/triggers', () => ({
  TriggerUtils: {
    findStartBlock: findStartBlockMock,
  },
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/executor', () => ({
  Executor: vi.fn().mockImplementation((args) => {
    executorConstructorMock(args)
    return {
      execute: executorExecuteMock,
      executeFromBlock: executorExecuteMock,
    }
  }),
}))

vi.mock('@/serializer', () => ({
  Serializer: vi.fn().mockImplementation(() => ({
    serializeWorkflow: serializeWorkflowMock,
  })),
}))

import {
  executeWorkflowCore,
  FINALIZED_EXECUTION_ID_TTL_MS,
  wasExecutionFinalizedByCore,
} from './execution-core'

describe('executeWorkflowCore terminal finalization sequencing', () => {
  const loggingSession = {
    safeStart: safeStartMock,
    safeComplete: safeCompleteMock,
    safeCompleteWithError: safeCompleteWithErrorMock,
    safeCompleteWithCancellation: safeCompleteWithCancellationMock,
    safeCompleteWithPause: safeCompleteWithPauseMock,
    hasCompleted: hasCompletedMock,
    onBlockStart: onBlockStartPersistenceMock,
    onBlockComplete: vi.fn(),
    setPostExecutionPromise: vi.fn(),
    waitForPostExecution: vi.fn().mockResolvedValue(undefined),
  }

  const createSnapshot = () => ({
    metadata: {
      requestId: 'req-1',
      workflowId: 'workflow-1',
      userId: 'user-1',
      workflowUserId: 'workflow-owner',
      workspaceId: 'workspace-1',
      triggerType: 'api',
      executionId: 'execution-1',
      triggerBlockId: undefined,
      useDraftState: true,
      isClientSession: false,
      enforceCredentialAccess: false,
      startTime: new Date().toISOString(),
    },
    workflow: {
      id: 'workflow-1',
      userId: 'workflow-owner',
      variables: {},
    },
    input: { hello: 'world' },
    workflowVariables: {},
    selectedOutputs: [],
    state: undefined,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()

    loadWorkflowFromNormalizedTablesMock.mockResolvedValue({
      blocks: {
        'start-block': {
          id: 'start-block',
          type: 'start_trigger',
          subBlocks: {},
          name: 'Start',
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    })

    loadDeployedWorkflowStateMock.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      deploymentVersionId: 'dep-1',
    })

    getPersonalAndWorkspaceEnvMock.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {},
      workspaceDecrypted: {},
    })

    mergeSubblockStateWithValuesMock.mockImplementation((blocks) => blocks)
    serializeWorkflowMock.mockReturnValue({ loops: {}, parallels: {} })
    buildTraceSpansMock.mockReturnValue({ traceSpans: [{ id: 'span-1' }], totalDuration: 123 })
    findStartBlockMock.mockReturnValue({
      blockId: 'start-block',
      block: { type: 'start_trigger' },
      path: ['start-block'],
    })
    safeStartMock.mockResolvedValue(true)
    safeCompleteMock.mockResolvedValue(undefined)
    safeCompleteWithErrorMock.mockResolvedValue(undefined)
    safeCompleteWithCancellationMock.mockResolvedValue(undefined)
    safeCompleteWithPauseMock.mockResolvedValue(undefined)
    hasCompletedMock.mockReturnValue(true)
    onBlockStartPersistenceMock.mockResolvedValue(undefined)
    updateWorkflowRunCountsMock.mockResolvedValue(undefined)
    clearExecutionCancellationMock.mockResolvedValue(undefined)
  })

  it('routes onBlockStart through logging session persistence path', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {
        onBlockStart: async (blockId) => {
          expect(blockId).toBe('block-1')
        },
      },
      loggingSession: loggingSession as any,
    })

    const contextExtensions = executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions
    await contextExtensions.onBlockStart('block-1', 'Fetch', 'api', 1)

    expect(onBlockStartPersistenceMock).toHaveBeenCalledWith(
      'block-1',
      'Fetch',
      'api',
      expect.any(String)
    )
  })

  it('uses external trigger selection for webhook executions without an explicit triggerBlockId', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: {
        ...createSnapshot(),
        metadata: {
          ...createSnapshot().metadata,
          triggerType: 'webhook',
        },
      } as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(findStartBlockMock).toHaveBeenCalledWith(expect.anything(), 'external', false)
  })

  it('does not await user block start callback after persistence completes', async () => {
    let releaseCallback: (() => void) | undefined
    const callbackPromise = new Promise<void>((resolve) => {
      releaseCallback = resolve
    })

    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {
        onBlockStart: vi.fn(() => callbackPromise),
      },
      loggingSession: loggingSession as any,
    })

    const contextExtensions = executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions

    await expect(
      contextExtensions.onBlockStart('block-1', 'Fetch', 'api', 1)
    ).resolves.toBeUndefined()

    releaseCallback?.()
  })

  it('awaits terminal completion before updating run counts and returning', async () => {
    const callOrder: string[] = []

    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    safeCompleteMock.mockImplementation(async () => {
      callOrder.push('safeComplete:start')
      await Promise.resolve()
      callOrder.push('safeComplete:end')
    })

    clearExecutionCancellationMock.mockImplementation(async () => {
      callOrder.push('clearCancellation')
    })

    updateWorkflowRunCountsMock.mockImplementation(async () => {
      callOrder.push('updateRunCounts')
    })

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    expect(result.status).toBe('completed')
    expect(callOrder).toEqual([
      'safeComplete:start',
      'safeComplete:end',
      'clearCancellation',
      'updateRunCounts',
    ])
  })

  it('awaits wrapped lifecycle persistence before terminal finalization returns', async () => {
    let releaseBlockStart: (() => void) | undefined
    const blockStartPromise = new Promise<void>((resolve) => {
      releaseBlockStart = resolve
    })
    const callOrder: string[] = []

    onBlockStartPersistenceMock.mockImplementation(async () => {
      callOrder.push('persist:start')
      await blockStartPromise
      callOrder.push('persist:end')
    })

    safeCompleteMock.mockImplementation(async () => {
      callOrder.push('safeComplete')
    })

    executorExecuteMock.mockImplementation(async () => {
      const contextExtensions = executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions
      const startLifecycle = contextExtensions.onBlockStart('block-1', 'Fetch', 'api', 1)
      await Promise.resolve()
      callOrder.push('executor:before-release')
      releaseBlockStart?.()
      await startLifecycle
      callOrder.push('executor:after-start')

      return {
        success: true,
        status: 'completed',
        output: { done: true },
        logs: [],
        metadata: { duration: 123, startTime: 'start', endTime: 'end' },
      }
    })

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(callOrder).toEqual([
      'persist:start',
      'executor:before-release',
      'persist:end',
      'executor:after-start',
      'safeComplete',
    ])
  })

  it('preserves successful execution when success finalization throws', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    const completionError = new Error('completion failed')
    safeCompleteMock.mockRejectedValue(completionError)

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    expect(result.status).toBe('completed')
    expect(clearExecutionCancellationMock).toHaveBeenCalledWith('execution-1')
    expect(updateWorkflowRunCountsMock).toHaveBeenCalledWith('workflow-1')
  })

  it('routes cancelled executions through safeCompleteWithCancellation', async () => {
    executorExecuteMock.mockResolvedValue({
      success: false,
      status: 'cancelled',
      output: {},
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(result.status).toBe('cancelled')
    expect(safeCompleteWithCancellationMock).toHaveBeenCalledTimes(1)
    expect(safeCompleteWithCancellationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        totalDurationMs: 123,
        traceSpans: [{ id: 'span-1' }],
      })
    )
    expect(safeCompleteMock).not.toHaveBeenCalled()
    expect(safeCompleteWithPauseMock).not.toHaveBeenCalled()
    expect(updateWorkflowRunCountsMock).not.toHaveBeenCalled()
  })

  it('routes paused executions through safeCompleteWithPause', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'paused',
      output: {},
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(result.status).toBe('paused')
    expect(safeCompleteWithPauseMock).toHaveBeenCalledTimes(1)
    expect(safeCompleteWithPauseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        totalDurationMs: 123,
        traceSpans: [{ id: 'span-1' }],
        workflowInput: { hello: 'world' },
      })
    )
    expect(safeCompleteMock).not.toHaveBeenCalled()
    expect(safeCompleteWithCancellationMock).not.toHaveBeenCalled()
    expect(updateWorkflowRunCountsMock).not.toHaveBeenCalled()
  })

  it('swallows wrapped block start callback failures without breaking execution', async () => {
    onBlockStartPersistenceMock.mockRejectedValue(new Error('start persistence failed'))

    executorExecuteMock.mockImplementation(async () => {
      const contextExtensions = executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions
      await contextExtensions.onBlockStart('block-1', 'Fetch', 'api', 1)

      return {
        success: true,
        status: 'completed',
        output: { done: true },
        logs: [],
        metadata: { duration: 123, startTime: 'start', endTime: 'end' },
      }
    })

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(result.status).toBe('completed')
    expect(safeCompleteMock).toHaveBeenCalledTimes(1)
  })

  it('swallows wrapped block complete callback failures without blocking completion', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {
        onBlockComplete: vi.fn().mockRejectedValue(new Error('complete callback failed')),
      },
      loggingSession: loggingSession as any,
    })

    const contextExtensions = executorConstructorMock.mock.calls[0]?.[0]?.contextExtensions

    await expect(
      contextExtensions.onBlockComplete('block-1', 'Fetch', 'api', {
        output: { ok: true },
        executionTime: 1,
        startedAt: 'start',
        endedAt: 'end',
      })
    ).resolves.toBeUndefined()
  })

  it('finalizes errors before rethrowing and marks them as core-finalized', async () => {
    const error = new Error('engine failed')
    const executionResult = {
      success: false,
      status: 'failed',
      output: {},
      error: 'engine failed',
      logs: [],
      metadata: { duration: 55, startTime: 'start', endTime: 'end' },
    }

    Object.assign(error, { executionResult })
    executorExecuteMock.mockRejectedValue(error)

    await expect(
      executeWorkflowCore({
        snapshot: createSnapshot() as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe(error)

    expect(safeCompleteWithErrorMock).toHaveBeenCalledTimes(1)
    expect(clearExecutionCancellationMock).toHaveBeenCalledWith('execution-1')
    expect(wasExecutionFinalizedByCore(error, 'execution-1')).toBe(true)
  })

  it('marks non-Error throws as core-finalized using executionId guard', async () => {
    executorExecuteMock.mockRejectedValue('engine failed')

    await expect(
      executeWorkflowCore({
        snapshot: createSnapshot() as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe('engine failed')

    expect(safeCompleteWithErrorMock).toHaveBeenCalledTimes(1)
    expect(wasExecutionFinalizedByCore('engine failed', 'execution-1')).toBe(true)
    expect(wasExecutionFinalizedByCore('engine failed', 'execution-1')).toBe(true)
  })

  it('expires stale finalized execution ids for callers that never consume the guard', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-13T00:00:00.000Z'))

    executorExecuteMock.mockRejectedValue('engine failed')

    await expect(
      executeWorkflowCore({
        snapshot: {
          ...createSnapshot(),
          metadata: {
            ...createSnapshot().metadata,
            executionId: 'execution-stale',
          },
        } as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe('engine failed')

    vi.setSystemTime(new Date(Date.now() + FINALIZED_EXECUTION_ID_TTL_MS + 1))

    await expect(
      executeWorkflowCore({
        snapshot: {
          ...createSnapshot(),
          metadata: {
            ...createSnapshot().metadata,
            executionId: 'execution-fresh',
          },
        } as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe('engine failed')

    expect(wasExecutionFinalizedByCore('engine failed', 'execution-stale')).toBe(false)
    expect(wasExecutionFinalizedByCore('engine failed', 'execution-fresh')).toBe(true)
  })

  it('removes expired finalized ids even when a reused id stays earlier in map order', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-13T00:00:00.000Z'))

    executorExecuteMock.mockRejectedValue('engine failed')

    await expect(
      executeWorkflowCore({
        snapshot: {
          ...createSnapshot(),
          metadata: {
            ...createSnapshot().metadata,
            executionId: 'execution-a',
          },
        } as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe('engine failed')

    vi.setSystemTime(new Date('2026-03-13T00:01:00.000Z'))

    await expect(
      executeWorkflowCore({
        snapshot: {
          ...createSnapshot(),
          metadata: {
            ...createSnapshot().metadata,
            executionId: 'execution-b',
          },
        } as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe('engine failed')

    vi.setSystemTime(new Date('2026-03-13T00:02:00.000Z'))

    await expect(
      executeWorkflowCore({
        snapshot: {
          ...createSnapshot(),
          metadata: {
            ...createSnapshot().metadata,
            executionId: 'execution-a',
          },
        } as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe('engine failed')

    vi.setSystemTime(new Date('2026-03-13T00:06:01.000Z'))

    expect(wasExecutionFinalizedByCore('engine failed', 'execution-b')).toBe(false)
    expect(wasExecutionFinalizedByCore('engine failed', 'execution-a')).toBe(true)
  })

  it('does not replace a successful outcome when success finalization rejects', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    safeCompleteMock.mockRejectedValue(new Error('completion failed'))

    const result = await executeWorkflowCore({
      snapshot: createSnapshot() as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    await loggingSession.setPostExecutionPromise.mock.calls[0][0]

    expect(result).toMatchObject({ status: 'completed', success: true })
    expect(clearExecutionCancellationMock).toHaveBeenCalledWith('execution-1')
    expect(safeCompleteWithErrorMock).not.toHaveBeenCalled()
  })

  it('does not replace a successful outcome when cancellation cleanup fails', async () => {
    executorExecuteMock.mockResolvedValue({
      success: true,
      status: 'completed',
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    clearExecutionCancellationMock.mockRejectedValue(new Error('cleanup failed'))

    await expect(
      executeWorkflowCore({
        snapshot: createSnapshot() as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).resolves.toMatchObject({ status: 'completed', success: true })

    expect(safeCompleteWithErrorMock).not.toHaveBeenCalled()
  })

  it('does not replace the original error when cancellation cleanup fails', async () => {
    const error = new Error('engine failed')
    executorExecuteMock.mockRejectedValue(error)
    clearExecutionCancellationMock.mockRejectedValue(new Error('cleanup failed'))

    await expect(
      executeWorkflowCore({
        snapshot: createSnapshot() as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe(error)

    expect(safeCompleteWithErrorMock).toHaveBeenCalledTimes(1)
  })

  it('does not mark core finalization when error completion never persists a log row', async () => {
    const error = new Error('engine failed')
    executorExecuteMock.mockRejectedValue(error)
    hasCompletedMock.mockReturnValue(false)
    const snapshot = {
      ...createSnapshot(),
      metadata: {
        ...createSnapshot().metadata,
        executionId: 'execution-unfinalized',
      },
    }

    await expect(
      executeWorkflowCore({
        snapshot: snapshot as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe(error)

    expect(safeCompleteWithErrorMock).toHaveBeenCalledTimes(1)
    expect(wasExecutionFinalizedByCore(error, 'execution-unfinalized')).toBe(false)
  })

  it('starts a minimal log session before error completion when setup fails early', async () => {
    const envError = new Error('env lookup failed')
    getPersonalAndWorkspaceEnvMock.mockRejectedValue(envError)

    await expect(
      executeWorkflowCore({
        snapshot: createSnapshot() as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe(envError)

    expect(safeStartMock).toHaveBeenCalledTimes(1)
    expect(safeStartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        variables: {},
      })
    )
    expect(safeCompleteWithErrorMock).toHaveBeenCalledTimes(1)
    expect(wasExecutionFinalizedByCore(envError, 'execution-1')).toBe(true)
  })

  it('skips core finalization when minimal error logging cannot start', async () => {
    const envError = new Error('env lookup failed')
    getPersonalAndWorkspaceEnvMock.mockRejectedValue(envError)
    safeStartMock.mockResolvedValue(false)
    const snapshot = {
      ...createSnapshot(),
      metadata: {
        ...createSnapshot().metadata,
        executionId: 'execution-no-log-start',
      },
    }

    await expect(
      executeWorkflowCore({
        snapshot: snapshot as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toBe(envError)

    expect(safeStartMock).toHaveBeenCalledTimes(1)
    expect(safeCompleteWithErrorMock).not.toHaveBeenCalled()
    expect(wasExecutionFinalizedByCore(envError, 'execution-no-log-start')).toBe(false)
  })

  it('uses sessionUserId for env resolution when isClientSession is true', async () => {
    const snapshot = {
      ...createSnapshot(),
      metadata: {
        ...createSnapshot().metadata,
        isClientSession: true,
        sessionUserId: 'session-user',
        workflowUserId: 'workflow-owner',
      },
    }

    getPersonalAndWorkspaceEnvMock.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {},
      workspaceDecrypted: {},
    })
    safeStartMock.mockResolvedValue(true)
    executorExecuteMock.mockResolvedValue({
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: snapshot as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(getPersonalAndWorkspaceEnvMock).toHaveBeenCalledWith('session-user', 'workspace-1')
  })

  it('uses workflowUserId for env resolution in server-side execution', async () => {
    const snapshot = {
      ...createSnapshot(),
      metadata: {
        ...createSnapshot().metadata,
        isClientSession: false,
        sessionUserId: undefined,
        workflowUserId: 'workflow-owner',
        userId: 'billing-actor',
      },
    }

    getPersonalAndWorkspaceEnvMock.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {},
      workspaceDecrypted: {},
    })
    safeStartMock.mockResolvedValue(true)
    executorExecuteMock.mockResolvedValue({
      output: { done: true },
      logs: [],
      metadata: { duration: 123, startTime: 'start', endTime: 'end' },
    })

    await executeWorkflowCore({
      snapshot: snapshot as any,
      callbacks: {},
      loggingSession: loggingSession as any,
    })

    expect(getPersonalAndWorkspaceEnvMock).toHaveBeenCalledWith('workflow-owner', 'workspace-1')
  })

  it('throws when workflowUserId is missing in server-side execution', async () => {
    const snapshot = {
      ...createSnapshot(),
      metadata: {
        ...createSnapshot().metadata,
        isClientSession: false,
        sessionUserId: undefined,
        workflowUserId: undefined,
        userId: 'billing-actor',
      },
    }

    await expect(
      executeWorkflowCore({
        snapshot: snapshot as any,
        callbacks: {},
        loggingSession: loggingSession as any,
      })
    ).rejects.toThrow('Missing workflowUserId in execution metadata')
  })
})
