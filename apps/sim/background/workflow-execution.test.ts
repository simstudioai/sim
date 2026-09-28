/**
 * @vitest-environment node
 */
import {
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  LoggingSessionMock,
  loggingSessionMock,
  loggingSessionMockFns,
} from '@sim/testing'
import {
  executionLimitsMock,
  executionLimitsMockFns,
} from '@sim/testing/mocks/execution-limits.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteWorkflowCore, mockWasExecutionFinalizedByCore } = vi.hoisted(() => ({
  mockExecuteWorkflowCore: vi.fn(),
  mockWasExecutionFinalizedByCore: vi.fn(),
}))

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)
vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)
vi.mock('@/lib/core/execution-limits', () => executionLimitsMock)
vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: mockExecuteWorkflowCore,
  wasExecutionFinalizedByCore: mockWasExecutionFinalizedByCore,
}))
vi.mock('@/lib/workflows/executor/pause-persistence', () => ({
  handlePostExecutionPauseState: vi.fn(),
}))
vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: vi.fn(() => ({ traceSpans: [] })),
}))
vi.mock('@/executor/execution/snapshot', () => ({ ExecutionSnapshot: vi.fn() }))
vi.mock('@/lib/uploads/utils/user-file-base64.server', () => ({
  cleanupExecutionBase64Cache: vi.fn(async () => {}),
}))

import * as usageReservation from '@/lib/billing/calculations/usage-reservation'
import { executeWorkflowJob, type WorkflowExecutionPayload } from '@/background/workflow-execution'
import { buildBlockExecutionError, markWorkflowUserFailure } from '@/executor/utils/errors'
import type { SerializedBlock } from '@/serializer/types'

const billingAttribution = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'user-1',
  billingEntity: { type: 'user' as const, id: 'user-1' },
  billingPeriod: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
  payerSubscription: null,
}

const payload: WorkflowExecutionPayload = {
  workflowId: 'workflow-1',
  principal: {
    version: 1,
    principal: {
      kind: 'system',
      serviceId: 'internal',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    },
  },
  userId: 'user-1',
  billingAttribution,
  workspaceId: 'workspace-1',
  executionId: 'execution-1',
  requestId: 'request-1',
  triggerType: 'api',
}

const planPanels = {
  id: 'plan-panels',
  metadata: { id: 'function', name: 'planPanels' },
} as SerializedBlock

describe('executeWorkflowJob fault vs workflow failure', () => {
  beforeEach(() => {
    vi.spyOn(usageReservation, 'refreshExecutionSlotExpiry').mockResolvedValue(true)
    vi.spyOn(usageReservation, 'releaseExecutionSlot').mockResolvedValue(undefined)
    executionLimitsMockFns.mockCreateTimeoutAbortController.mockImplementation(() => ({
      signal: new AbortController().signal,
      cleanup: vi.fn(),
      abort: vi.fn(),
      isTimedOut: () => false,
      timeoutMs: 120_000,
    }))
    LoggingSessionMock.mockImplementation(function LoggingSession() {
      return {
        safeCompleteWithError: loggingSessionMockFns.mockSafeCompleteWithError,
        waitForPostExecution: loggingSessionMockFns.mockWaitForPostExecution,
        markAsFailed: loggingSessionMockFns.mockMarkAsFailed,
        setExecutionDeadlineAt: loggingSessionMockFns.mockSetExecutionDeadlineAt,
        projectDiagnosticError: loggingSessionMockFns.mockProjectDiagnosticError,
      }
    })
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: 'user-1',
      billingAttribution,
      workflowRecord: {
        id: 'workflow-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        variables: {},
      },
    })
  })

  it('completes the job when a workflow user failure is recorded only after core throws', async () => {
    const blockError = buildBlockExecutionError({
      block: planPanels,
      error: markWorkflowUserFailure(
        new Error("ValueError: Doctrine has no sheet layout for kind ''")
      ),
    })
    let recorded = false
    mockExecuteWorkflowCore.mockRejectedValue(blockError)
    loggingSessionMockFns.mockWaitForPostExecution.mockImplementation(async () => {
      recorded = true
    })
    mockWasExecutionFinalizedByCore.mockImplementation(() => recorded)

    const result = await executeWorkflowJob(payload)

    expect(result).toMatchObject({
      success: false,
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      error: blockError.message,
    })
    expect(loggingSessionMockFns.mockSafeCompleteWithError).not.toHaveBeenCalled()
  })

  it('faults the job on an unmarked block failure even when core recorded it', async () => {
    const internalError = buildBlockExecutionError({
      block: planPanels,
      error: new Error('An internal error occurred while running this block'),
    })
    mockExecuteWorkflowCore.mockRejectedValue(internalError)
    mockWasExecutionFinalizedByCore.mockReturnValue(true)

    await expect(executeWorkflowJob(payload)).rejects.toBe(internalError)
    expect(loggingSessionMockFns.mockSafeCompleteWithError).not.toHaveBeenCalled()
  })

  it('faults the job when core never recorded the failure', async () => {
    const setupError = new Error('Workflow state not found')
    mockExecuteWorkflowCore.mockRejectedValue(setupError)
    mockWasExecutionFinalizedByCore.mockReturnValue(false)

    await expect(executeWorkflowJob(payload)).rejects.toBe(setupError)
    expect(loggingSessionMockFns.mockSafeCompleteWithError).toHaveBeenCalled()
  })
})
