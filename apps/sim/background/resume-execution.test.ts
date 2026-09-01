/**
 * @vitest-environment node
 */

import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockTask,
  mockGetPausedExecutionById,
  mockStartResumeExecution,
  mockFindCellContextByExecutionId,
  mockSnapshotFromJson,
  mockCreateResumeAttemptTimeoutController,
  mockIsTimedOut,
} = vi.hoisted(() => ({
  mockTask: vi.fn((config) => config),
  mockGetPausedExecutionById: vi.fn(),
  mockStartResumeExecution: vi.fn(),
  mockFindCellContextByExecutionId: vi.fn(),
  mockSnapshotFromJson: vi.fn(),
  mockCreateResumeAttemptTimeoutController: vi.fn(),
  mockIsTimedOut: vi.fn(() => false),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask, timeout: { None: 'none' } }))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  assertBillingAttributionSnapshot: vi.fn((value) => value),
}))

vi.mock('@/lib/table/cascade-lock', () => ({ withCascadeLock: vi.fn() }))
vi.mock('@/lib/table/deps', () => ({ isExecCancelled: vi.fn(() => false) }))

vi.mock('@/lib/table/workflow-columns', () => ({
  findCellContextByExecutionId: mockFindCellContextByExecutionId,
}))

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  createResumeAttemptTimeoutController: mockCreateResumeAttemptTimeoutController,
  PauseResumeManager: {
    getPausedExecutionById: mockGetPausedExecutionById,
    startResumeExecution: mockStartResumeExecution,
  },
}))

vi.mock('@/executor/execution/snapshot', () => ({
  ExecutionSnapshot: { fromJSON: mockSnapshotFromJson },
}))

import { executeResumeJob, type ResumeExecutionPayload } from '@/background/resume-execution'

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
    vi.clearAllMocks()
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

  it('rethrows the original genuine resume fault', async () => {
    const rawError = new Error('MCP setup exposed activated-secret-value')
    mockStartResumeExecution.mockRejectedValue(rawError)

    await expect(executeResumeJob(payload)).rejects.toBe(rawError)
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
