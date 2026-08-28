/**
 * @vitest-environment node
 */

import {
  dbChainMock,
  dbChainMockFns,
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  LoggingSessionMock,
  loggerMock,
  loggingSessionMock,
  loggingSessionMockFns,
  resetDbChainMock,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMISSION_ERROR_CODE } from '@/lib/core/admission/transient-failure'

const {
  mockTask,
  mockExecuteWorkflowCore,
  mockExecutionSnapshot,
  mockWasExecutionFinalizedByCore,
  mockHasExecutionResult,
  mockRefreshExecutionSlotExpiry,
  mockIsWorkflowTimedOut,
  mockGetScheduleTimeValues,
  mockGetSubBlockValue,
} = vi.hoisted(() => ({
  mockTask: vi.fn((config) => config),
  mockExecuteWorkflowCore: vi.fn(),
  mockExecutionSnapshot: vi.fn(),
  mockWasExecutionFinalizedByCore: vi.fn(),
  mockHasExecutionResult: vi.fn(),
  mockRefreshExecutionSlotExpiry: vi.fn().mockResolvedValue(true),
  mockIsWorkflowTimedOut: vi.fn(() => false),
  mockGetScheduleTimeValues: vi.fn(),
  mockGetSubBlockValue: vi.fn(),
}))

const mockPreprocessExecution = executionPreprocessingMockFns.mockPreprocessExecution
const mockLoadDeployedWorkflowState = workflowsPersistenceUtilsMockFns.mockLoadDeployedWorkflowState

vi.mock('@trigger.dev/sdk', () => ({ task: mockTask, timeout: { None: 'none' } }))

vi.mock('@sim/db', () => ({
  ...dbChainMock,
  workflow: {},
  workflowSchedule: {},
}))

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)

vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  refreshExecutionSlotExpiry: mockRefreshExecutionSlotExpiry,
  releaseExecutionSlot: vi.fn(),
}))

vi.mock('@/lib/core/execution-limits', () => ({
  ExecutionTimeoutError: class ExecutionTimeoutError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'TimeoutError'
    }
  },
  capExecutionTimeoutMs: vi.fn((policyTimeoutMs, requestedTimeoutMs) =>
    requestedTimeoutMs === undefined ? policyTimeoutMs : requestedTimeoutMs
  ),
  createTimeoutAbortController: vi.fn(() => ({
    signal: new AbortController().signal,
    cleanup: vi.fn(),
    isTimedOut: mockIsWorkflowTimedOut,
    timeoutMs: 120_000,
  })),
  getAsyncExecutionTimeoutForBillingAttribution: vi.fn(() => 120_000),
  getExecutionDeadlineAt: vi.fn(() => new Date(Date.now() + 120_000)),
  getExecutionTimeout: vi.fn(() => 120_000),
  getTimeoutErrorMessage: vi.fn(() => 'Execution timed out after 2 minutes'),
  RESERVATION_TTL_BUFFER_MS: 300_000,
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: vi.fn(() => ({ traceSpans: [] })),
}))

vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: mockExecuteWorkflowCore,
  wasExecutionFinalizedByCore: mockWasExecutionFinalizedByCore,
}))

vi.mock('@/lib/workflows/executor/human-in-the-loop-manager', () => ({
  PauseResumeManager: {
    persistPauseResult: vi.fn(),
    processQueuedResumes: vi.fn(),
  },
}))

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
  principal: { kind: 'session' as const, userId: 'actor-1', sessionId: 'session-1' },
}

describe('async preprocessing correlation threading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
        principal: { kind: 'session', userId: 'actor-1', sessionId: 'session-1' },
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
        principal: {
          kind: 'workspace_api_key' as const,
          workspaceId: 'workspace-1',
          keyId: 'workspace-key-1',
        },
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
        principal: {
          kind: 'session',
          userId: 'actor-1',
          sessionId: 'legacy-queued-workflow',
        },
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

  it('passes validated workflow input provenance from the queued payload into core execution', async () => {
    const provenance = {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: 'encrypted-token' }],
      scope: { userId: 'parent-owner', workspaceId: 'workspace-1' },
    }
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
      triggerType: 'workflow',
      executionId: 'execution-with-provenance',
      requestId: 'request-with-provenance',
      trustedInitialResolvedSecretTraceProvenance: provenance,
    })

    expect(mockExecuteWorkflowCore).toHaveBeenCalledWith(
      expect.objectContaining({ trustedInitialResolvedSecretTraceProvenance: provenance })
    )
  })

  it('preserves a core-finalized execution error for task failure semantics', async () => {
    const rawError = Object.assign(new Error('Function 1 failed with activated-secret-value'), {
      executionResult: {
        success: false,
        output: { error: 'Function failed' },
        logs: [],
      },
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
    mockHasExecutionResult.mockImplementation((error) => error === rawError)
    mockWasExecutionFinalizedByCore.mockReturnValue(true)

    await expect(
      executeWorkflowJob({
        principal,
        workflowId: 'workflow-1',
        userId: 'actor-1',
        workspaceId: 'workspace-1',
        billingAttribution,
        triggerType: 'api',
        executionId: 'execution-finalized',
        requestId: 'request-finalized',
      })
    ).rejects.toBe(rawError)

    expect(loggingSessionMockFns.mockWaitForPostExecution).not.toHaveBeenCalled()
    expect(mockWasExecutionFinalizedByCore).toHaveBeenCalledWith(rawError, 'execution-finalized')
    expect(loggingSessionMockFns.mockSafeCompleteWithError).not.toHaveBeenCalled()
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
    expect(loggingSessionMockFns.mockProjectDiagnosticError).toHaveBeenCalledWith(rawError, {
      executionId: 'execution-fault',
    })
    expect(workflowExecutionLogger.error).toHaveBeenCalledWith(
      '[request-fault] Workflow execution failed: workflow-1',
      { executionId: 'execution-fault', error: projectedError }
    )
    const loggerPayload = JSON.stringify(workflowExecutionLogger.error.mock.calls)
    expect(loggerPayload).not.toContain(secret)
    expect(loggerPayload).not.toContain('__var_')
    expect(loggerPayload).not.toContain('__sim_')
    expect(rawError.message).toContain(secret)
  })

  it('does not pre-start schedule logging before core execution', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'actor-2',
      workflowRecord: {
        id: 'workflow-1',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        variables: {},
      },
      billingAttribution: { ...billingAttribution, actorUserId: 'actor-2' },
      executionTimeout: {},
    })
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'success',
      output: { ok: true },
      metadata: { duration: 12, userId: 'actor-2' },
    })

    await executeScheduleJob({
      scheduleId: 'schedule-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      billingAttribution: { ...billingAttribution, actorUserId: 'actor-2' },
      executionId: 'execution-2',
      requestId: 'request-2',
      now: '2025-01-01T00:00:00.000Z',
      scheduledFor: '2025-01-01T00:00:00.000Z',
    })

    const loggingSession = LoggingSessionMock.mock.results[0]?.value
    expect(loggingSession).toBeDefined()
    expect(loggingSession.safeStart).not.toHaveBeenCalled()
    expect(mockExecuteWorkflowCore).toHaveBeenCalledWith(
      expect.objectContaining({
        loggingSession,
      })
    )
    const executionMetadata = mockExecutionSnapshot.mock.calls[0]?.[0]
    expect(executionMetadata.userId).toBe('actor-2')
    expect(executionMetadata.principal).toEqual({
      kind: 'system',
      serviceId: 'schedule',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    })
  })

  it('passes workflow correlation into preprocessing', async () => {
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
        executionId: 'execution-1',
        requestId: 'request-1',
        billingAttribution,
      })
    ).rejects.toThrow('preprocessing failed')

    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        billingAttribution,
        triggerData: {
          correlation: {
            executionId: 'execution-1',
            requestId: 'request-1',
            source: 'workflow',
            workflowId: 'workflow-1',
            triggerType: 'api',
          },
        },
      })
    )
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

  it('passes schedule correlation into preprocessing', async () => {
    mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message: 'auth failed', statusCode: 401 },
    })

    await executeScheduleJob({
      scheduleId: 'schedule-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      executionId: 'execution-2',
      requestId: 'request-2',
      now: '2025-01-01T00:00:00.000Z',
      scheduledFor: '2025-01-01T00:00:00.000Z',
      billingAttribution,
    })

    expect(mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        billingAttribution,
        triggerData: {
          correlation: {
            executionId: 'execution-2',
            requestId: 'request-2',
            source: 'schedule',
            workflowId: 'workflow-1',
            scheduleId: 'schedule-1',
            triggerType: 'schedule',
            scheduledFor: '2025-01-01T00:00:00.000Z',
          },
        },
      })
    )
  })

  it('increments infrastructure retry count for retryable schedule preprocessing failures', async () => {
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
      executionId: 'execution-retry',
      requestId: 'request-retry',
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
