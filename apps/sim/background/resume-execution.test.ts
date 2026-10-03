import { loggerMock } from '@sim/testing'
import { billingAttributionMock } from '@sim/testing/mocks/billing-attribution.mock'
import {
  humanInTheLoopManagerMock,
  humanInTheLoopManagerMockFns,
} from '@sim/testing/mocks/human-in-the-loop-manager.mock'
import {
  tableWorkflowColumnsMock,
  tableWorkflowColumnsMockFns,
} from '@sim/testing/mocks/table-workflow-columns.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSnapshotFromJson, mockIsTimedOut } = vi.hoisted(() => ({
  mockSnapshotFromJson: vi.fn(),
  mockIsTimedOut: vi.fn(() => false),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

vi.mock('@/lib/table/cascade-lock', () => ({ withCascadeLock: vi.fn() }))
vi.mock('@/lib/table/deps', () => ({ isExecCancelled: vi.fn(() => false) }))

vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => humanInTheLoopManagerMock)

vi.mock('@/executor/execution/snapshot', () => ({
  ExecutionSnapshot: { fromJSON: mockSnapshotFromJson },
}))

import { executeResumeJob, type ResumeExecutionPayload } from '@/background/resume-execution'

const { mockFindCellContextByExecutionId } = tableWorkflowColumnsMockFns
const {
  mockGetPausedExecutionById,
  mockStartResumeExecution,
  mockCreateResumeAttemptTimeoutController,
} = humanInTheLoopManagerMockFns

const resumeExecutionLoggerCallIndex = loggerMock.createLogger.mock.calls.findIndex(
  ([name]) => name === 'TriggerResumeExecution'
)
const resumeExecutionLogger =
  loggerMock.createLogger.mock.results[resumeExecutionLoggerCallIndex]?.value
if (!resumeExecutionLogger) {
  throw new Error('TriggerResumeExecution logger mock was not initialized')
}

const payload: ResumeExecutionPayload = {
  resumeEntryId: 'resume-entry-1',
  resumeExecutionId: 'resume-execution-1',
  pausedExecutionId: 'paused-execution-1',
  contextId: 'context-1',
  resumeInput: {},
  userId: 'user-1',
  workflowId: 'workflow-1',
  parentExecutionId: 'parent-execution-1',
}

describe('executeResumeJob terminal errors', () => {
  beforeEach(() => {
    mockGetPausedExecutionById.mockResolvedValue({
      executionSnapshot: { snapshot: {} },
    })
    mockCreateResumeAttemptTimeoutController.mockReturnValue({
      signal: new AbortController().signal,
      cleanup: vi.fn(),
      abort: vi.fn(),
      isTimedOut: mockIsTimedOut,
      timeoutMs: 5_000,
    })
    mockSnapshotFromJson.mockReturnValue({
      metadata: {
        billingAttribution: {
          actorUserId: 'user-1',
          workspaceId: 'workspace-1',
        },
      },
    })
    mockFindCellContextByExecutionId.mockResolvedValue(null)
    mockIsTimedOut.mockReturnValue(false)
  })

  it('rethrows the original core-finalized resume error', async () => {
    const secret = 'activated-secret-value'
    const rawError = Object.assign(new Error(`Agent tool exposed ${secret} __var_API_KEY`), {
      executionResult: {
        success: false,
        output: { error: 'Agent tool failed' },
        logs: [],
      },
    })
    mockStartResumeExecution.mockRejectedValue(rawError)

    await expect(executeResumeJob(payload)).rejects.toBe(rawError)

    expect(resumeExecutionLogger.error).toHaveBeenCalledWith('Background resume execution failed', {
      errorType: 'error',
      hasStack: true,
    })
    const loggerPayload = JSON.stringify(resumeExecutionLogger.error.mock.calls)
    expect(loggerPayload).not.toContain(secret)
    expect(loggerPayload).not.toContain('__var_')
    expect(rawError.message).toContain(secret)
  })

  it('starts a legacy attempt deadline before deserializing the full snapshot', async () => {
    mockStartResumeExecution.mockResolvedValue({
      success: true,
      status: 'completed',
    })

    await executeResumeJob(payload)

    expect(mockCreateResumeAttemptTimeoutController).toHaveBeenCalledWith(
      { snapshot: {} },
      undefined,
      undefined
    )
    expect(mockCreateResumeAttemptTimeoutController.mock.invocationCallOrder[0]).toBeLessThan(
      mockSnapshotFromJson.mock.invocationCallOrder[0]
    )
  })

  it('fails the backing job when a resume cooperatively reaches its deadline', async () => {
    mockIsTimedOut.mockReturnValue(true)
    mockStartResumeExecution.mockResolvedValue({
      success: false,
      status: 'cancelled',
    })

    await expect(executeResumeJob(payload)).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'Execution timed out after 5 seconds',
    })
  })
})
