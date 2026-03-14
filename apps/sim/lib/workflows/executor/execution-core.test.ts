import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  loadWorkflowFromNormalizedTablesMock,
  loadDeployedWorkflowStateMock,
  getPersonalAndWorkspaceEnvMock,
  mergeSubblockStateWithValuesMock,
  safeStartMock,
  safeCompleteMock,
  safeCompleteWithErrorMock,
  safeCompleteWithCancellationMock,
  safeCompleteWithPauseMock,
  hasCompletedMock,
  updateWorkflowRunCountsMock,
  clearExecutionCancellationMock,
  buildTraceSpansMock,
  serializeWorkflowMock,
  executorExecuteMock,
} = vi.hoisted(() => ({
  loadWorkflowFromNormalizedTablesMock: vi.fn(),
  loadDeployedWorkflowStateMock: vi.fn(),
  getPersonalAndWorkspaceEnvMock: vi.fn(),
  mergeSubblockStateWithValuesMock: vi.fn(),
  safeStartMock: vi.fn(),
  safeCompleteMock: vi.fn(),
  safeCompleteWithErrorMock: vi.fn(),
  safeCompleteWithCancellationMock: vi.fn(),
  safeCompleteWithPauseMock: vi.fn(),
  hasCompletedMock: vi.fn(),
  updateWorkflowRunCountsMock: vi.fn(),
  clearExecutionCancellationMock: vi.fn(),
  buildTraceSpansMock: vi.fn(),
  serializeWorkflowMock: vi.fn(),
  executorExecuteMock: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/environment/utils', () => ({
  getPersonalAndWorkspaceEnv: getPersonalAndWorkspaceEnvMock,
}))

vi.mock('@/lib/execution/cancellation', () => ({
  clearExecutionCancellation: clearExecutionCancellationMock,
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: buildTraceSpansMock,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: loadWorkflowFromNormalizedTablesMock,
  loadDeployedWorkflowState: loadDeployedWorkflowStateMock,
}))

vi.mock('@/lib/workflows/subblocks', () => ({
  mergeSubblockStateWithValues: mergeSubblockStateWithValuesMock,
}))

vi.mock('@/lib/workflows/triggers/triggers', () => ({
  TriggerUtils: {
    findStartBlock: vi.fn().mockReturnValue({
      blockId: 'start-block',
      block: { type: 'start_trigger' },
      path: ['start-block'],
    }),
  },
}))

vi.mock('@/lib/workflows/utils', () => ({
  updateWorkflowRunCounts: updateWorkflowRunCountsMock,
}))

vi.mock('@/executor', () => ({
  Executor: vi.fn().mockImplementation(() => ({
    execute: executorExecuteMock,
    executeFromBlock: executorExecuteMock,
  })),
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
    setPostExecutionPromise: vi.fn(),
    waitForPostExecution: vi.fn().mockResolvedValue(undefined),
  }

  const createSnapshot = () => ({
    metadata: {
      requestId: 'req-1',
      workflowId: 'workflow-1',
      userId: 'user-1',
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
    safeStartMock.mockResolvedValue(true)
    safeCompleteMock.mockResolvedValue(undefined)
    safeCompleteWithErrorMock.mockResolvedValue(undefined)
    safeCompleteWithCancellationMock.mockResolvedValue(undefined)
    safeCompleteWithPauseMock.mockResolvedValue(undefined)
    hasCompletedMock.mockReturnValue(true)
    updateWorkflowRunCountsMock.mockResolvedValue(undefined)
    clearExecutionCancellationMock.mockResolvedValue(undefined)
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

  it('clears cancellation even when success finalization throws', async () => {
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
    expect(updateWorkflowRunCountsMock).not.toHaveBeenCalled()
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

  it('logs error without rejecting when success finalization rejects', async () => {
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

    expect(result.status).toBe('completed')
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
})
