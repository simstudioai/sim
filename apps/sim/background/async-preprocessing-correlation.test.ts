import {
  billingUsageReservationMock,
  billingUsageReservationMockFns,
  dbChainMockFns,
  executionLimitsMock,
  executionLimitsMockFns,
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  humanInTheLoopManagerMock,
  LoggingSessionMock,
  loggerMock,
  loggingSessionMock,
  loggingSessionMockFns,
  resetDbChainMock,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMISSION_ERROR_CODE } from '@/lib/core/admission/transient-failure'
import { ExecutionScopeDeletedError } from '@/lib/core/errors/execution-scope-deleted'

const {
  mockExecuteWorkflowCore,
  mockExecutionSnapshot,
  mockWasExecutionFinalizedByCore,
  mockHasExecutionResult,
  mockIsWorkflowTimedOut,
  mockGetScheduleTimeValues,
  mockGetSubBlockValue,
} = vi.hoisted(() => ({
  mockExecuteWorkflowCore: vi.fn(),
  mockExecutionSnapshot: vi.fn(),
  mockWasExecutionFinalizedByCore: vi.fn(),
  mockHasExecutionResult: vi.fn(),
  mockIsWorkflowTimedOut: vi.fn(() => false),
  mockGetScheduleTimeValues: vi.fn(),
  mockGetSubBlockValue: vi.fn(),
}))

const mockPreprocessExecution = executionPreprocessingMockFns.mockPreprocessExecution
const mockLoadDeployedWorkflowState = workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)

vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

vi.mock('@/lib/billing/calculations/usage-reservation', () => billingUsageReservationMock)

vi.mock('@/lib/core/execution-limits', () => executionLimitsMock)

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: vi.fn(() => ({ traceSpans: [] })),
}))

vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: mockExecuteWorkflowCore,
  wasExecutionFinalizedByCore: mockWasExecutionFinalizedByCore,
}))

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => humanInTheLoopManagerMock)

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

vi.mock('@/lib/workflows/schedules/utils', () => ({
  calculateNextRunTime: vi.fn(),
  getScheduleTimeValues: mockGetScheduleTimeValues,
  getSubBlockValue: mockGetSubBlockValue,
}))

vi.mock('@/executor/execution/snapshot', () => ({
  ExecutionSnapshot: mockExecutionSnapshot,
}))

vi.mock('@/executor/utils/errors', () => ({
  hasExecutionResult: mockHasExecutionResult,
}))

import { executeScheduleJob } from './schedule-execution'
import { executeWorkflowJob } from './workflow-execution'

billingUsageReservationMockFns.mockRefreshExecutionSlotExpiry.mockResolvedValue(true)
executionLimitsMockFns.mockGetAsyncExecutionTimeoutForBillingAttribution.mockReturnValue(120_000)
executionLimitsMockFns.mockGetExecutionTimeout.mockReturnValue(120_000)
executionLimitsMockFns.mockGetExecutionDeadlineAt.mockImplementation(
  () => new Date(Date.now() + 120_000)
)
executionLimitsMockFns.mockCreateTimeoutAbortController.mockImplementation(() => ({
  signal: new AbortController().signal,
  cleanup: vi.fn(),
  abort: vi.fn(),
  isTimedOut: mockIsWorkflowTimedOut,
  timeoutMs: 120_000,
}))

const workflowExecutionLoggerCallIndex = loggerMock.createLogger.mock.calls.findIndex(
  ([name]) => name === 'TriggerWorkflowExecution'
)
const workflowExecutionLogger =
  loggerMock.createLogger.mock.results[workflowExecutionLoggerCallIndex]?.value
if (!workflowExecutionLogger) {
  throw new Error('TriggerWorkflowExecution logger mock was not initialized')
}

const billingAttribution = {
  actorUserId: 'actor-1',
  workspaceId: 'workspace-1',
  organizationId: null,
  billedAccountUserId: 'actor-1',
  billingEntity: { type: 'user' as const, id: 'actor-1' },
  billingPeriod: {
    start: '2025-01-01T00:00:00.000Z',
    end: '2025-02-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

const principal = {
  version: 1 as const,
  principal: createSessionPrincipal({ userId: 'actor-1' }),
}

describe('async preprocessing correlation threading', () => {
  beforeEach(() => {
    mockWasExecutionFinalizedByCore.mockReturnValue(false)
    mockHasExecutionResult.mockReturnValue(false)
    mockIsWorkflowTimedOut.mockReturnValue(false)
    resetDbChainMock()
    dbChainMockFns.limit.mockResolvedValue([
      {
        id: 'schedule-1',
        workflowId: 'workflow-1',
        status: 'active',
        archivedAt: null,
        lastQueuedAt: new Date('2025-01-01T00:00:00.000Z'),
        deploymentOperationId: null,
      },
    ])
    mockLoadDeployedWorkflowState.mockResolvedValue({
      blocks: {
        'schedule-block': {
          type: 'schedule',
        },
      },
      edges: [],
      loops: {},
      parallels: {},
      deploymentVersionId: 'deployment-1',
    })
    mockGetSubBlockValue.mockReturnValue('daily')
    mockGetScheduleTimeValues.mockReturnValue({ timezone: 'UTC' })
  })

  it('does not pre-start workflow logging before core execution', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
      billingAttribution,
      executionTimeout: {},
    })
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'success',
      output: { ok: true },
      metadata: { duration: 10, userId: 'actor-1' },
    })

    await executeWorkflowJob({
      principal,
      workflowId: 'workflow-1',
      userId: 'actor-1',
      workspaceId: 'workspace-1',
      billingAttribution,
      triggerType: 'api',
      executionId: 'execution-1',
      requestId: 'request-1',
    })

    const loggingSession = LoggingSessionMock.mock.results[0]?.value
    expect(loggingSession).toBeDefined()
    expect(loggingSession.safeStart).not.toHaveBeenCalled()
    expect(mockExecuteWorkflowCore).toHaveBeenCalledWith(
      expect.objectContaining({
        loggingSession,
      })
    )
    expect(mockExecutionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: createSessionPrincipal({ userId: 'actor-1' }),
      }),
      expect.anything(),
      undefined,
      expect.any(Object),
      expect.any(Array)
    )
  })

  it.each([
    {
      name: 'workspace API key',
      serializedPrincipal: {
        version: 1 as const,
        principal: createWorkspaceApiKeyPrincipal({ keyId: 'workspace-key-1' }),
      },
      isPublicApiAccess: false,
    },
    {
      name: 'public API system',
      serializedPrincipal: {
        version: 1 as const,
        principal: {
          kind: 'system' as const,
          serviceId: 'public_api' as const,
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
        },
      },
      isPublicApiAccess: true,
    },
  ])(
    'restores the exact serialized $name principal before Trigger worker execution',
    async ({ serializedPrincipal, isPublicApiAccess }) => {
      mockPreprocessExecution.mockResolvedValueOnce({
        success: true,
        actorUserId: 'actor-1',
        workflowRecord: {
          id: 'workflow-1',
          userId: 'owner-1',
          workspaceId: 'workspace-1',
          variables: {},
        },
        billingAttribution,
        executionTimeout: {},
      })
      mockExecuteWorkflowCore.mockResolvedValueOnce({
        success: true,
        status: 'success',
        output: { ok: true },
        metadata: { duration: 10, userId: 'actor-1' },
      })

      await executeWorkflowJob({
        principal: serializedPrincipal,
        workflowId: 'workflow-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        billingAttribution,
        triggerType: 'api',
        executionId: `execution-${serializedPrincipal.principal.kind}`,
        requestId: `request-${serializedPrincipal.principal.kind}`,
        isPublicApiAccess,
      })

      const executionMetadata = mockExecutionSnapshot.mock.calls[0]?.[0]
      expect(executionMetadata.userId).toBe('actor-1')
      expect(executionMetadata.principal).toEqual(serializedPrincipal.principal)
      expect(executionMetadata.isPublicApiAccess).toBe(isPublicApiAccess)
      expect(executionMetadata.principal).not.toHaveProperty('userId')
    }
  )

  it('restores a legacy authenticated workflow job as its recorded user actor', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
      billingAttribution,
      executionTimeout: {},
    })
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'success',
      output: { ok: true },
      metadata: { duration: 10, userId: 'actor-1' },
    })

    await executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'actor-1',
      workspaceId: 'workspace-1',
      billingAttribution,
      triggerType: 'api',
      executionId: 'legacy-user-execution',
      requestId: 'legacy-user-request',
      enforceCredentialAccess: true,
    })

    expect(mockExecutionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: createSessionPrincipal({
          userId: 'actor-1',
          sessionId: 'legacy-queued-workflow',
        }),
      }),
      expect.anything(),
      undefined,
      expect.any(Object),
      expect.any(Array)
    )
  })

  it('restores an identity-ambiguous legacy workflow job as actorless', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
      billingAttribution,
      executionTimeout: {},
    })
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'success',
      output: { ok: true },
      metadata: { duration: 10, userId: 'actor-1' },
    })

    await executeWorkflowJob({
      workflowId: 'workflow-1',
      userId: 'actor-1',
      workspaceId: 'workspace-1',
      billingAttribution,
      triggerType: 'api',
      executionId: 'legacy-actorless-execution',
      requestId: 'legacy-actorless-request',
    })

    expect(mockExecutionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: {
          kind: 'system',
          serviceId: 'internal',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
        },
      }),
      expect.anything(),
      undefined,
      expect.any(Object),
      expect.any(Array)
    )
  })

  describe('a workflow failure core already recorded', () => {
    const recordedError = () =>
      Object.assign(new Error('Function 1 failed: RuntimeError'), {
        executionResult: { success: false, output: { error: 'Function failed' }, logs: [] },
      })

    /** Core marks the failure finalized from a post-execution promise it does not await. */
    function finalizeWhenPostExecutionSettles() {
      let finalized = false
      loggingSessionMockFns.mockWaitForPostExecution.mockImplementationOnce(async () => {
        await Promise.resolve()
        finalized = true
      })
      mockWasExecutionFinalizedByCore.mockImplementation(() => finalized)
    }

    function runRecordedFailure(executionId: string) {
      mockPreprocessExecution.mockResolvedValueOnce({
        success: true,
        actorUserId: 'actor-1',
        workflowRecord: {
          id: 'workflow-1',
          userId: 'owner-1',
          workspaceId: 'workspace-1',
          variables: {},
        },
        billingAttribution,
        executionTimeout: {},
      })
      return executeWorkflowJob({
        principal,
        workflowId: 'workflow-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        billingAttribution,
        triggerType: 'api',
        executionId,
        requestId: 'request-recorded',
      })
    }

    it('completes the job with the failure once core finalization settles', async () => {
      const error = recordedError()
      mockExecuteWorkflowCore.mockRejectedValueOnce(error)
      mockHasExecutionResult.mockImplementation((value) => value === error)
      finalizeWhenPostExecutionSettles()

      await expect(runRecordedFailure('execution-recorded')).resolves.toMatchObject({
        success: false,
        workflowId: 'workflow-1',
        executionId: 'execution-recorded',
        error: 'Function 1 failed: RuntimeError',
      })
      expect(loggingSessionMockFns.mockSafeCompleteWithError).not.toHaveBeenCalled()
    })

    it('still fails the job when the deadline passes while finalization settles', async () => {
      const error = recordedError()
      mockExecuteWorkflowCore.mockRejectedValueOnce(error)
      let timedOut = false
      mockIsWorkflowTimedOut.mockImplementation(() => timedOut)
      loggingSessionMockFns.mockWaitForPostExecution.mockImplementationOnce(async () => {
        await Promise.resolve()
        timedOut = true
      })
      mockWasExecutionFinalizedByCore.mockReturnValue(true)

      await expect(runRecordedFailure('execution-recorded-deadline')).rejects.toBe(error)
      expect(loggingSessionMockFns.mockSafeCompleteWithError).not.toHaveBeenCalled()
    })

    it('still fails the job when the run passed its deadline', async () => {
      const error = recordedError()
      mockExecuteWorkflowCore.mockRejectedValueOnce(error)
      mockIsWorkflowTimedOut.mockReturnValue(true)
      mockWasExecutionFinalizedByCore.mockReturnValue(true)

      await expect(runRecordedFailure('execution-recorded-late')).rejects.toBe(error)
      expect(loggingSessionMockFns.mockSafeCompleteWithError).not.toHaveBeenCalled()
    })
  })

  describe('a run whose workspace was deleted', () => {
    afterEach(() => {
      loggingSessionMockFns.mockGetDeletedScope.mockReset()
      loggingSessionMockFns.mockSafeCompleteWithError.mockReset()
    })

    function runInDeletedWorkspace(executionId: string) {
      mockPreprocessExecution.mockResolvedValueOnce({
        success: true,
        actorUserId: 'actor-1',
        workflowRecord: {
          id: 'workflow-1',
          userId: 'owner-1',
          workspaceId: 'workspace-1',
          variables: {},
        },
        billingAttribution,
        executionTimeout: {},
      })
      return executeWorkflowJob({
        principal,
        workflowId: 'workflow-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        billingAttribution,
        triggerType: 'api',
        executionId,
        requestId: 'request-deleted',
      })
    }

    it('completes without alerting when core finds the workspace gone at start', async () => {
      mockExecuteWorkflowCore.mockRejectedValueOnce(
        new ExecutionScopeDeletedError('execution-deleted-start', 'workspace')
      )

      await expect(runInDeletedWorkspace('execution-deleted-start')).resolves.toMatchObject({
        success: false,
        executionId: 'execution-deleted-start',
        error: 'The workspace of execution execution-deleted-start was deleted',
      })
      expect(loggingSessionMockFns.mockSafeCompleteWithError).not.toHaveBeenCalled()
      expect(workflowExecutionLogger.info).toHaveBeenCalledWith(
        '[request-deleted] Workflow execution ended: its workspace was deleted',
        { workflowId: 'workflow-1', executionId: 'execution-deleted-start' }
      )
    })

    it('completes without alerting when a block fails after the workspace is deleted mid-run', async () => {
      const blockError = new Error('insert or update on table "workspace_files" violates FK')
      mockExecuteWorkflowCore.mockRejectedValueOnce(blockError)
      let deletedScope: 'workspace' | null = null
      loggingSessionMockFns.mockGetDeletedScope.mockImplementation(() => deletedScope)
      loggingSessionMockFns.mockWaitForPostExecution.mockImplementationOnce(async () => {
        await Promise.resolve()
        deletedScope = 'workspace'
      })

      await expect(runInDeletedWorkspace('execution-deleted-mid')).resolves.toMatchObject({
        success: false,
        executionId: 'execution-deleted-mid',
        error: blockError.message,
      })
      expect(loggingSessionMockFns.mockSafeCompleteWithError).not.toHaveBeenCalled()
    })

    it('completes without alerting when its own failure log finds the workspace gone', async () => {
      const pipelineError = new Error('Workflow state not found')
      mockExecuteWorkflowCore.mockRejectedValueOnce(pipelineError)
      loggingSessionMockFns.mockSafeCompleteWithError.mockImplementationOnce(async () => {
        loggingSessionMockFns.mockGetDeletedScope.mockReturnValue('workspace')
      })

      await expect(runInDeletedWorkspace('execution-deleted-log')).resolves.toMatchObject({
        success: false,
        error: pipelineError.message,
      })
      expect(loggingSessionMockFns.mockSafeCompleteWithError).toHaveBeenCalledTimes(1)
    })

    it('completes without alerting when a run in a deleted workspace times out', async () => {
      mockIsWorkflowTimedOut.mockReturnValue(true)
      mockExecuteWorkflowCore.mockResolvedValueOnce({
        success: false,
        status: 'cancelled',
        output: undefined,
        metadata: { duration: 120_000, userId: 'actor-1' },
      })
      loggingSessionMockFns.mockGetDeletedScope.mockReturnValue('workspace')

      await expect(runInDeletedWorkspace('execution-deleted-timeout')).resolves.toMatchObject({
        success: false,
        error: 'Execution timed out after 2 minutes',
      })
    })
  })

  it('fails the backing job after a cooperative workflow timeout is finalized', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
      billingAttribution,
      executionTimeout: {},
    })
    mockIsWorkflowTimedOut.mockReturnValue(true)
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: false,
      status: 'cancelled',
      output: undefined,
      metadata: { duration: 120_000, userId: 'actor-1' },
    })

    await expect(
      executeWorkflowJob({
        principal,
        workflowId: 'workflow-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        billingAttribution,
        triggerType: 'api',
        executionId: 'execution-timeout',
        requestId: 'request-timeout',
      })
    ).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'Execution timed out after 2 minutes',
    })

    expect(loggingSessionMockFns.mockMarkAsFailed).toHaveBeenCalledWith(
      'Execution timed out after 2 minutes'
    )
    expect(loggingSessionMockFns.mockWaitForPostExecution).toHaveBeenCalled()
    expect(loggingSessionMockFns.mockSafeCompleteWithError).not.toHaveBeenCalled()
  })

  it('persists and rethrows the original unfinalized execution error', async () => {
    const secret = 'activated-secret-value'
    const rawError = new Error(
      `Function 1 failed with ${secret} __var_API_KEY __sim_code_1_binding_0`
    )
    const projectedError = 'Function 1 failed with {{API_KEY}} {{API_KEY}} [RUNTIME_BINDING]'
    loggingSessionMockFns.mockProjectDiagnosticError.mockReturnValueOnce({
      executionId: 'execution-fault',
      error: projectedError,
    })
    mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'actor-1',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
      billingAttribution,
      executionTimeout: {},
    })
    mockExecuteWorkflowCore.mockRejectedValueOnce(rawError)

    await expect(
      executeWorkflowJob({
        principal,
        workflowId: 'workflow-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        billingAttribution,
        triggerType: 'api',
        executionId: 'execution-fault',
        requestId: 'request-fault',
      })
    ).rejects.toBe(rawError)

    expect(loggingSessionMockFns.mockSafeCompleteWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: rawError.message,
        }),
      })
    )
    expect(loggingSessionMockFns.mockProjectDiagnosticError).toHaveBeenCalledWith(rawError)
    expect(workflowExecutionLogger.error).toHaveBeenCalledWith(
      '[request-fault] Workflow execution failed: workflow-1',
      { executionId: 'execution-fault', error: projectedError, failureKind: 'internal' }
    )
    const loggerPayload = JSON.stringify(workflowExecutionLogger.error.mock.calls)
    expect(loggerPayload).not.toContain(secret)
    expect(loggerPayload).not.toContain('__var_')
    expect(loggerPayload).not.toContain('__sim_')
    expect(rawError.message).toContain(secret)
  })

  it('does not repeat admission gates for route-admitted workflow jobs', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message: 'preprocessing failed', statusCode: 500 },
    })

    await expect(
      executeWorkflowJob({
        principal,
        workflowId: 'workflow-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        triggerType: 'api',
        executionId: 'execution-admitted',
        requestId: 'request-admitted',
        billingAttribution,
        admissionCompleted: true,
      })
    ).rejects.toThrow('preprocessing failed')

    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        checkRateLimit: false,
        skipUsageLimits: true,
      })
    )
  })

  describe('a preprocessing rejection', () => {
    function runRejected(error: Record<string, unknown>) {
      mockPreprocessExecution.mockResolvedValueOnce({ success: false, error })
      return executeWorkflowJob({
        principal,
        workflowId: 'workflow-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        triggerType: 'api',
        executionId: 'execution-rejected',
        requestId: 'request-rejected',
        billingAttribution,
      })
    }

    it.each([
      { statusCode: 404, message: 'Workflow not found', workflowState: 'not_found' },
      {
        statusCode: 403,
        message: 'Workflow is not deployed',
        code: 'WORKFLOW_NOT_DEPLOYED',
        workflowState: 'not_deployed',
      },
      {
        statusCode: 403,
        message:
          'This workflow is not attached to a workspace. Personal workflows are deprecated and cannot execute.',
        workflowState: 'not_attached',
      },
    ])('completes the job for a $statusCode $message that never started a log', async (error) => {
      loggingSessionMockFns.mockHasCompleted.mockReturnValueOnce(false)

      await expect(runRejected(error)).resolves.toMatchObject({
        success: false,
        workflowId: 'workflow-1',
        executionId: 'execution-rejected',
        error: error.message,
      })
    })

    const loggedRejections = [
      {
        statusCode: 402,
        message: 'Usage limit exceeded. Please upgrade your plan to continue.',
        code: 'USAGE_LIMIT_EXCEEDED',
      },
      {
        statusCode: 402,
        message: 'Usage headroom exhausted',
        code: 'EXECUTION_PAYER_HEADROOM_EXHAUSTED',
        retryable: false,
      },
      {
        statusCode: 429,
        message: 'Rate limit exceeded. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
      { statusCode: 403, message: 'Account suspended', code: 'ACCOUNT_SUSPENDED' },
    ]

    it.each(loggedRejections)('completes the job for a logged $code rejection', async (error) => {
      loggingSessionMockFns.mockHasCompleted.mockReturnValueOnce(true)

      await expect(runRejected(error)).resolves.toMatchObject({
        success: false,
        workflowId: 'workflow-1',
        executionId: 'execution-rejected',
        error: error.message,
      })
      expect(loggingSessionMockFns.mockSafeCompleteWithError).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ message: error.message }) })
      )
    })

    it.each(loggedRejections)(
      'fails the job when a $code rejection could not be logged',
      async (error) => {
        loggingSessionMockFns.mockHasCompleted.mockReturnValueOnce(false)

        await expect(runRejected(error)).rejects.toThrow(error.message)
      }
    )

    it.each([
      { statusCode: 429, message: 'Too many concurrent executions', retryable: true },
      { statusCode: 402, message: 'Usage is temporarily unavailable', retryable: true },
      { statusCode: 503, message: 'Usage admission is temporarily unavailable', retryable: true },
      { statusCode: 500, message: 'Internal error while fetching workflow' },
      { statusCode: 404, message: 'Workflow not found' },
    ])('fails the job for $statusCode $message', async (error) => {
      await expect(runRejected(error)).rejects.toThrow(error.message)
    })
  })

  it('routes retryable reservation concurrency through bounded infrastructure backoff', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Too many concurrent executions',
        statusCode: 429,
        retryable: true,
        code: ADMISSION_ERROR_CODE.RESERVATION_CONCURRENCY,
      },
    })

    await executeScheduleJob({
      scheduleId: 'schedule-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      billingAttribution,
      executionId: 'execution-concurrency-retry',
      requestId: 'request-concurrency-retry',
      now: '2025-01-01T00:00:00.000Z',
      scheduledFor: '2025-01-01T00:00:00.000Z',
      infraRetryCount: 2,
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastQueuedAt: null,
        infraRetryCount: 3,
      })
    )
  })

  it('keeps retryable non-admission 429 failures on the fixed rate-limit delay', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Rate limit exceeded',
        statusCode: 429,
        retryable: true,
        code: 'RATE_LIMIT_EXCEEDED',
      },
    })

    await executeScheduleJob({
      scheduleId: 'schedule-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      billingAttribution,
      executionId: 'execution-rate-limit',
      requestId: 'request-rate-limit',
      now: '2025-01-01T00:00:00.000Z',
      scheduledFor: '2025-01-01T00:00:00.000Z',
      infraRetryCount: 2,
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastQueuedAt: null,
        infraRetryCount: 0,
      })
    )
    const update = dbChainMockFns.set.mock.calls.at(-1)?.[0]
    expect(update.nextRunAt.getTime() - update.updatedAt.getTime()).toBe(5 * 60 * 1000)
  })

  it('moves exhausted infrastructure retries onto the normal failure path', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'database unavailable',
        statusCode: 500,
        retryable: true,
        cause: { code: '53300' },
      },
    })

    await executeScheduleJob({
      scheduleId: 'schedule-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      billingAttribution,
      executionId: 'execution-retry-exhausted',
      requestId: 'request-retry-exhausted',
      now: '2025-01-01T00:00:00.000Z',
      scheduledFor: '2025-01-01T00:00:00.000Z',
      infraRetryCount: 10,
    })

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        lastQueuedAt: null,
        lastFailedAt: expect.any(Date),
        infraRetryCount: 0,
      })
    )
  })
})
