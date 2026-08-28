/**
 * @vitest-environment node
 */

import {
  dbChainMockFns,
  environmentUtilsMockFns,
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  LoggingSessionMock,
  loggerMock,
  loggingSessionMock,
  loggingSessionMockFns,
  resetEnvironmentUtilsMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveWebhookRecordProviderConfig,
  mockExecuteWorkflowCore,
  mockWasExecutionFinalizedByCore,
  mockExecuteWithIdempotency,
  mockRefreshExecutionSlotExpiry,
  mockReleaseExecutionSlot,
  mockLoadDeploymentVersionState,
  mockGetProviderHandler,
  mockSetResolvedSecretTraceRegistry,
  mockExecutionSnapshot,
  mockEnqueue,
  mockGetJobQueue,
} = vi.hoisted(() => {
  const mockEnqueue = vi.fn()
  return {
    mockResolveWebhookRecordProviderConfig: vi.fn(),
    mockExecuteWorkflowCore: vi.fn(),
    mockWasExecutionFinalizedByCore: vi.fn(),
    mockExecuteWithIdempotency: vi.fn(),
    mockRefreshExecutionSlotExpiry: vi.fn().mockResolvedValue(true),
    mockReleaseExecutionSlot: vi.fn(),
    mockGetProviderHandler: vi.fn(() => ({})),
    mockSetResolvedSecretTraceRegistry: vi.fn(),
    mockExecutionSnapshot: vi.fn(),
    mockLoadDeploymentVersionState: vi.fn(
      async (_workflowId: string, deploymentVersionId: string) => ({
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        deploymentVersionId,
      })
    ),
    mockEnqueue,
    mockGetJobQueue: vi.fn(async () => ({ enqueue: mockEnqueue })),
  }
})

const mockGetEffectiveEnvironmentSnapshot =
  environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot

afterAll(resetEnvironmentUtilsMock)

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)
vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

vi.mock('@/lib/webhooks/env-resolver', () => ({
  resolveWebhookRecordProviderConfig: mockResolveWebhookRecordProviderConfig,
}))

vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: mockExecuteWorkflowCore,
  wasExecutionFinalizedByCore: mockWasExecutionFinalizedByCore,
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  refreshExecutionSlotExpiry: mockRefreshExecutionSlotExpiry,
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))

vi.mock('@/lib/core/idempotency', () => ({
  IdempotencyService: { createWebhookIdempotencyKey: vi.fn(() => 'idempotency-key') },
  webhookIdempotency: {
    executeWithIdempotency: mockExecuteWithIdempotency,
  },
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState: vi.fn(async () => ({
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
    deploymentVersionId: 'deployment-1',
  })),
  loadWorkflowDeploymentVersionState: mockLoadDeploymentVersionState,
}))

vi.mock('@/lib/webhooks/providers', () => ({ getProviderHandler: mockGetProviderHandler }))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: vi.fn(() => ({ traceSpans: [] })),
}))

vi.mock('@/lib/core/execution-limits', () => ({
  capExecutionTimeoutMs: vi.fn((policyTimeoutMs, requestedTimeoutMs) =>
    requestedTimeoutMs === undefined ? policyTimeoutMs : requestedTimeoutMs
  ),
  createTimeoutAbortController: vi.fn(() => ({
    signal: new AbortController().signal,
    cleanup: vi.fn(),
    isTimedOut: () => false,
    timeoutMs: 120_000,
  })),
  getAsyncExecutionTimeoutForBillingAttribution: vi.fn(() => 120_000),
  getExecutionDeadlineAt: vi.fn(() => new Date(Date.now() + 120_000)),
  getTimeoutErrorMessage: vi.fn(() => 'timed out'),
  RESERVATION_TTL_BUFFER_MS: 300_000,
  toTriggerMaxDurationSeconds: vi.fn(() => undefined),
}))

vi.mock('@/lib/core/async-jobs', () => ({
  getJobQueue: mockGetJobQueue,
}))

vi.mock('@/lib/workflows/executor/pause-persistence', () => ({
  handlePostExecutionPauseState: vi.fn(),
}))

vi.mock('@/lib/webhooks/attachment-processor', () => ({
  WebhookAttachmentProcessor: class {},
}))

vi.mock('@/lib/oauth/credential-service', () => ({
  resolveOAuthAccountId: vi.fn(),
}))

vi.mock('@/executor/execution/snapshot', () => ({
  ExecutionSnapshot: mockExecutionSnapshot,
}))

vi.mock('@/tools/safe-assign', () => ({ safeAssign: vi.fn() }))

vi.mock('@/blocks', () => ({ getBlock: vi.fn(() => null) }))

vi.mock('@/triggers', () => ({
  getTrigger: vi.fn(),
  isTriggerValid: vi.fn(() => false),
}))

import { isRetryableSetupError } from '@/lib/core/errors/retryable-infrastructure'
import {
  executeWebhookJob,
  resolveWebhookExecutionProviderConfig,
  type WebhookExecutionPayload,
} from './webhook-execution'

const webhookExecutionLoggerCallIndex = loggerMock.createLogger.mock.calls.findIndex(
  ([name]) => name === 'TriggerWebhookExecution'
)
const webhookExecutionLogger =
  loggerMock.createLogger.mock.results[webhookExecutionLoggerCallIndex]?.value
if (!webhookExecutionLogger) {
  throw new Error('TriggerWebhookExecution logger mock was not initialized')
}

describe('resolveWebhookExecutionProviderConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the resolved webhook record when provider config resolution succeeds', async () => {
    const webhookRecord = {
      id: 'webhook-1',
      providerConfig: {
        botToken: '{{SLACK_BOT_TOKEN}}',
      },
    }
    const resolvedWebhookRecord = {
      ...webhookRecord,
      providerConfig: {
        botToken: 'xoxb-resolved',
      },
    }

    mockResolveWebhookRecordProviderConfig.mockResolvedValue(resolvedWebhookRecord)

    await expect(
      resolveWebhookExecutionProviderConfig(webhookRecord, 'slack', 'user-1', 'workspace-1')
    ).resolves.toEqual(resolvedWebhookRecord)

    expect(mockResolveWebhookRecordProviderConfig).toHaveBeenCalledWith(
      webhookRecord,
      'user-1',
      'workspace-1'
    )
  })

  it('throws a contextual error when provider config resolution fails', async () => {
    mockResolveWebhookRecordProviderConfig.mockRejectedValue(new Error('env lookup failed'))

    await expect(
      resolveWebhookExecutionProviderConfig(
        {
          id: 'webhook-1',
          providerConfig: {
            botToken: '{{SLACK_BOT_TOKEN}}',
          },
        },
        'slack',
        'user-1',
        'workspace-1'
      )
    ).rejects.toThrow(
      'Failed to resolve webhook provider config for slack webhook webhook-1: env lookup failed'
    )
  })
})

describe('executeWebhookJob fault vs error handling', () => {
  const billingAttribution = {
    actorUserId: 'user-1',
    workspaceId: 'workspace-1',
    organizationId: null,
    billedAccountUserId: 'user-1',
    billingEntity: { type: 'user' as const, id: 'user-1' },
    billingPeriod: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    },
    payerSubscription: null,
  }
  const payload: WebhookExecutionPayload = {
    webhookId: 'webhook-1',
    workflowId: 'workflow-1',
    principal: {
      version: 1,
      principal: {
        kind: 'system',
        serviceId: 'webhook',
        webhookId: 'webhook-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        provider: 'gmail',
      },
    },
    userId: 'user-1',
    billingAttribution,
    executionId: 'execution-1',
    requestId: 'request-1',
    provider: 'gmail',
    body: { message: 'hello' },
    headers: {},
    path: '/webhook',
    workspaceId: 'workspace-1',
  }
  const legacyPayload = {
    webhookId: payload.webhookId,
    workflowId: payload.workflowId,
    userId: payload.userId,
    billingAttribution: payload.billingAttribution,
    executionId: payload.executionId,
    requestId: payload.requestId,
    provider: payload.provider,
    body: payload.body,
    headers: payload.headers,
    path: payload.path,
    workspaceId: payload.workspaceId,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    LoggingSessionMock.mockImplementation(function LoggingSession() {
      return {
        safeStart: loggingSessionMockFns.mockSafeStart,
        safeComplete: loggingSessionMockFns.mockSafeComplete,
        safeCompleteWithError: loggingSessionMockFns.mockSafeCompleteWithError,
        waitForPostExecution: loggingSessionMockFns.mockWaitForPostExecution,
        markAsFailed: loggingSessionMockFns.mockMarkAsFailed,
        setExecutionDeadlineAt: loggingSessionMockFns.mockSetExecutionDeadlineAt,
        setResolvedSecretTraceRegistry: mockSetResolvedSecretTraceRegistry,
        projectDiagnosticError: loggingSessionMockFns.mockProjectDiagnosticError,
      }
    })
    mockGetProviderHandler.mockReturnValue({})
    mockEnqueue.mockResolvedValue('run_retry')
    mockExecuteWithIdempotency.mockImplementation(
      (_provider: string, _key: string, operation: () => Promise<unknown>) => operation()
    )
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValue({
      success: true,
      actorUserId: 'user-1',
      billingAttribution,
      workflowRecord: {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        variables: {},
        isDeployed: true,
        archivedAt: null,
      },
      executionTimeout: { async: 120_000 },
    })
    mockResolveWebhookRecordProviderConfig.mockImplementation(async (record) => record)
    mockGetEffectiveEnvironmentSnapshot.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: {},
      personalDecrypted: {},
      workspaceDecrypted: {},
      conflicts: [],
      decryptionFailures: [],
    })
    dbChainMockFns.limit.mockResolvedValue([{ id: 'webhook-1' }])
  })

  it('restores a legacy queued webhook as its canonical system principal', async () => {
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'completed',
      output: {},
      logs: [],
      executionState: {
        blockStates: {},
        executedBlocks: [],
        blockLogs: [],
        decisions: {},
        completedLoops: [],
        activeExecutionPath: [],
      },
    })

    await executeWebhookJob(legacyPayload)

    expect(mockExecutionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: {
          kind: 'system',
          serviceId: 'webhook',
          webhookId: 'webhook-1',
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          provider: 'gmail',
        },
      }),
      expect.anything(),
      expect.anything(),
      expect.any(Object),
      expect.any(Array)
    )
  })

  it('restores the exact serialized webhook principal without substituting the billing actor', async () => {
    const serializedPrincipal = {
      version: 1 as const,
      principal: {
        kind: 'system' as const,
        serviceId: 'webhook' as const,
        webhookId: 'webhook-1',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
        provider: 'slack',
        subject: {
          kind: 'external_user' as const,
          provider: 'slack',
          tenantId: 'team-1',
          subjectId: 'slack-user-1',
        },
      },
    }
    mockExecuteWorkflowCore.mockResolvedValueOnce({
      success: true,
      status: 'completed',
      output: {},
      logs: [],
      executionState: {
        blockStates: {},
        executedBlocks: [],
        blockLogs: [],
        decisions: {},
        completedLoops: [],
        activeExecutionPath: [],
      },
    })

    await executeWebhookJob({
      ...payload,
      provider: 'slack',
      principal: serializedPrincipal,
    })

    const executionMetadata = mockExecutionSnapshot.mock.calls[0]?.[0]
    expect(executionMetadata.userId).toBe('user-1')
    expect(executionMetadata.principal).toEqual(serializedPrincipal.principal)
    expect(executionMetadata.principal).not.toHaveProperty('userId')
  })

  it('persists the reconstructed legacy principal on setup retries', async () => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Internal error while fetching workflow',
        statusCode: 500,
        retryable: true,
        cause: { code: 'CONNECT_TIMEOUT' },
      },
    })

    await expect(executeWebhookJob(legacyPayload)).resolves.toMatchObject({
      success: false,
      requeued: true,
    })

    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEnqueue.mock.calls[0][1]).toMatchObject({
      principal: payload.principal,
      infraRetryCount: 1,
    })
  })

  it('completes the run (does not throw) when the failure was finalized by core', async () => {
    mockExecuteWorkflowCore.mockRejectedValue(
      new Error('Gmail 2 is missing required fields: Label')
    )
    mockWasExecutionFinalizedByCore.mockReturnValue(true)

    const result = await executeWebhookJob(payload)

    expect(result).toMatchObject({
      success: false,
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      provider: 'gmail',
    })
    expect(loggingSessionMockFns.mockWaitForPostExecution).toHaveBeenCalled()
    // User/workflow errors are already recorded by core — the catch must not re-log them.
    expect(loggingSessionMockFns.mockSafeCompleteWithError).not.toHaveBeenCalled()
  })

  it('faults the run (re-throws) when the failure was not finalized by core', async () => {
    const secret = 'webhook-error-secret-7f3a91'
    const rawError = new Error(
      `Workflow state not found ${secret} __var_API_KEY __sim_code_1_binding_0`
    )
    const projectedError = 'Workflow state not found {{API_KEY}} {{API_KEY}} [RUNTIME_BINDING]'
    loggingSessionMockFns.mockProjectDiagnosticError.mockReturnValueOnce({
      workflowId: 'workflow-1',
      provider: 'gmail',
      error: projectedError,
    })
    mockExecuteWorkflowCore.mockRejectedValue(rawError)
    mockWasExecutionFinalizedByCore.mockReturnValue(false)

    await expect(executeWebhookJob(payload)).rejects.toBe(rawError)
    // waitForPostExecution must run on every path so the finalized-by-core signal is always reliable.
    expect(loggingSessionMockFns.mockWaitForPostExecution).toHaveBeenCalled()
    // Pipeline/infra errors are recorded here before re-throwing to fault the trigger.dev run.
    expect(loggingSessionMockFns.mockSafeCompleteWithError).toHaveBeenCalled()
    expect(loggingSessionMockFns.mockProjectDiagnosticError).toHaveBeenCalledWith(rawError, {
      workflowId: 'workflow-1',
      provider: 'gmail',
    })
    expect(webhookExecutionLogger.error).toHaveBeenCalledWith(
      '[request-1] Webhook execution failed',
      { workflowId: 'workflow-1', provider: 'gmail', error: projectedError }
    )
    const loggerPayload = JSON.stringify(webhookExecutionLogger.error.mock.calls)
    expect(loggerPayload).not.toContain(secret)
    expect(loggerPayload).not.toContain('__var_')
    expect(loggerPayload).not.toContain('__sim_')
    expect(rawError.message).toContain(secret)
  })

  it('executes against the deployment version admitted by webhook ingress', async () => {
    mockExecuteWorkflowCore.mockResolvedValue({
      success: true,
      status: 'completed',
      output: {},
      logs: [],
      executionState: {
        blockStates: {},
        executedBlocks: [],
        blockLogs: [],
        decisions: {},
        completedLoops: [],
        activeExecutionPath: [],
      },
    })

    await executeWebhookJob({
      ...payload,
      deploymentVersionId: 'deployment-admitted',
    })

    expect(mockLoadDeploymentVersionState).toHaveBeenCalledWith(
      'workflow-1',
      'deployment-admitted',
      'workspace-1'
    )
  })

  it('does not pass provider-config provenance absent from the trigger input', async () => {
    mockGetEffectiveEnvironmentSnapshot.mockResolvedValue({
      personalEncrypted: { WEBHOOK_SECRET: 'personal-ciphertext' },
      workspaceEncrypted: { WEBHOOK_SECRET: 'workspace-ciphertext' },
      personalDecrypted: { WEBHOOK_SECRET: 'personal-value' },
      workspaceDecrypted: { WEBHOOK_SECRET: 'workspace-value' },
      conflicts: ['WEBHOOK_SECRET'],
      decryptionFailures: [],
    })
    mockResolveWebhookRecordProviderConfig.mockImplementation(
      async (record, _userId, _workspaceId, options) => {
        options.onResolved('WEBHOOK_SECRET', options.envVars.WEBHOOK_SECRET)
        return record
      }
    )
    mockExecuteWorkflowCore.mockResolvedValue({
      success: true,
      status: 'completed',
      output: {},
      logs: [],
      executionState: {
        blockStates: {},
        executedBlocks: [],
        blockLogs: [],
        decisions: {},
        completedLoops: [],
        activeExecutionPath: [],
      },
    })

    await executeWebhookJob(payload)

    expect(mockResolveWebhookRecordProviderConfig).toHaveBeenCalledWith(
      { id: 'webhook-1' },
      'user-1',
      'workspace-1',
      expect.objectContaining({
        envVars: { WEBHOOK_SECRET: 'workspace-value' },
        onResolved: expect.any(Function),
      })
    )
    expect(mockExecuteWorkflowCore).toHaveBeenCalledWith(
      expect.objectContaining({
        trustedInitialResolvedSecretTraceProvenance: {
          version: 1,
          complete: true,
          entries: [],
          scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        },
      })
    )
    expect(mockSetResolvedSecretTraceRegistry).toHaveBeenCalledOnce()
  })

  it('passes provider-config provenance when its value crosses in the trigger input', async () => {
    mockGetEffectiveEnvironmentSnapshot.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: { WEBHOOK_SECRET: 'workspace-ciphertext' },
      personalDecrypted: {},
      workspaceDecrypted: { WEBHOOK_SECRET: 'workspace-value' },
      conflicts: [],
      decryptionFailures: [],
    })
    mockResolveWebhookRecordProviderConfig.mockImplementation(
      async (record, _userId, _workspaceId, options) => {
        options.onResolved('WEBHOOK_SECRET', options.envVars.WEBHOOK_SECRET)
        return record
      }
    )
    mockGetProviderHandler.mockReturnValue({
      formatInput: vi.fn().mockResolvedValue({
        input: { authorization: 'Bearer workspace-value' },
      }),
    })
    mockExecuteWorkflowCore.mockResolvedValue({
      success: true,
      status: 'completed',
      output: {},
      logs: [],
      executionState: {
        blockStates: {},
        executedBlocks: [],
        blockLogs: [],
        decisions: {},
        completedLoops: [],
        activeExecutionPath: [],
      },
    })

    await executeWebhookJob(payload)

    expect(mockExecuteWorkflowCore).toHaveBeenCalledWith(
      expect.objectContaining({
        trustedInitialResolvedSecretTraceProvenance: {
          version: 1,
          complete: true,
          entries: [{ name: 'WEBHOOK_SECRET', encryptedValue: 'workspace-ciphertext' }],
          scope: { userId: 'user-1', workspaceId: 'workspace-1' },
        },
      })
    )
  })

  it('installs provenance before a post-resolution webhook setup failure', async () => {
    const rawMessage = 'Webhook handler exposed activated-secret-value'
    const rawError = new Error(rawMessage)
    mockGetEffectiveEnvironmentSnapshot.mockResolvedValue({
      personalEncrypted: {},
      workspaceEncrypted: { WEBHOOK_SECRET: 'workspace-ciphertext' },
      personalDecrypted: {},
      workspaceDecrypted: { WEBHOOK_SECRET: 'activated-secret-value' },
      conflicts: [],
      decryptionFailures: [],
    })
    mockResolveWebhookRecordProviderConfig.mockImplementation(
      async (record, _userId, _workspaceId, options) => {
        options.onResolved('WEBHOOK_SECRET', options.envVars.WEBHOOK_SECRET)
        return record
      }
    )
    mockGetProviderHandler.mockReturnValue({
      formatInput: vi.fn().mockRejectedValue(rawError),
    })

    await expect(executeWebhookJob(payload)).rejects.toBe(rawError)

    expect(mockSetResolvedSecretTraceRegistry).toHaveBeenCalledOnce()
    expect(loggingSessionMockFns.mockSafeCompleteWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: rawMessage }),
      })
    )
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
  })

  it('acknowledges and skips queued webhook work after the workflow is undeployed', async () => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValueOnce({
      success: true,
      actorUserId: 'user-1',
      billingAttribution,
      workflowRecord: {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        variables: {},
        isDeployed: false,
        archivedAt: null,
      },
      executionTimeout: { async: 120_000 },
    })

    const result = await executeWebhookJob(payload)

    expect(result).toMatchObject({ skipped: true, success: false, workflowId: 'workflow-1' })
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).toHaveBeenCalled()
  })

  it('releases the reservation when idempotency returns a cached result', async () => {
    const cachedResult = {
      success: true,
      workflowId: 'workflow-1',
      executionId: 'original-execution',
    }
    mockExecuteWithIdempotency.mockResolvedValueOnce(cachedResult)

    await expect(executeWebhookJob(payload)).resolves.toBe(cachedResult)

    expect(executionPreprocessingMockFns.mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-1')
  })

  it('releases the reservation when background preprocessing fails', async () => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message: 'workflow archived', statusCode: 404 },
    })

    await expect(executeWebhookJob(payload)).rejects.toThrow('workflow archived')

    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-1')
  })

  it('rejects queued webhook work without an immutable attribution snapshot', async () => {
    await expect(
      executeWebhookJob({
        ...payload,
        billingAttribution: undefined,
      } as unknown as WebhookExecutionPayload)
    ).rejects.toThrow('Billing attribution snapshot must be an object')

    expect(executionPreprocessingMockFns.mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('requeues the delivery when preprocessing fails on retryable infrastructure', async () => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Internal error while fetching workflow',
        statusCode: 500,
        retryable: true,
        cause: { code: 'CONNECT_TIMEOUT' },
      },
    })

    const result = await executeWebhookJob(payload)

    expect(result).toMatchObject({
      success: false,
      requeued: true,
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
    expect(executionPreprocessingMockFns.mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ suppressRetryableFailureLogs: true })
    )
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    const [jobType, retryPayload, options] = mockEnqueue.mock.calls[0]
    expect(jobType).toBe('webhook-execution')
    expect(retryPayload).toMatchObject({
      webhookId: 'webhook-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      requestId: 'request-1',
      infraRetryCount: 1,
    })
    expect(options.delayMs).toBeGreaterThan(0)
    // Database backend executes only through an in-process runner; trigger.dev ignores it.
    expect(options.runner).toBeTypeOf('function')
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-1')
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
    // No terminal failure row for an attempt that will be retried.
    expect(loggingSessionMockFns.mockSafeCompleteWithError).not.toHaveBeenCalled()
  })

  it('requeues on retryable infrastructure errors thrown by setup reads', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(
      Object.assign(new Error('write CONNECT_TIMEOUT'), { code: 'CONNECT_TIMEOUT' })
    )

    const result = await executeWebhookJob(payload)

    expect(result).toMatchObject({ success: false, requeued: true })
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockExecuteWorkflowCore).not.toHaveBeenCalled()
    expect(loggingSessionMockFns.mockSafeCompleteWithError).not.toHaveBeenCalled()
  })

  it('faults the run without requeueing once the retry budget is exhausted', async () => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Internal error while fetching workflow',
        statusCode: 500,
        retryable: true,
      },
    })

    await expect(executeWebhookJob({ ...payload, infraRetryCount: 5 })).rejects.toSatisfy(
      (error: unknown) => isRetryableSetupError(error)
    )

    expect(executionPreprocessingMockFns.mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({ suppressRetryableFailureLogs: false })
    )
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockReleaseExecutionSlot).toHaveBeenCalledWith('execution-1')
  })

  it('does not requeue non-retryable preprocessing failures', async () => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message: 'Usage limit exceeded', statusCode: 402 },
    })

    await expect(executeWebhookJob(payload)).rejects.toSatisfy(
      (error: unknown) =>
        !isRetryableSetupError(error) && (error as Error).message === 'Usage limit exceeded'
    )

    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('never reclassifies infrastructure errors after the workflow core started', async () => {
    const infraError = Object.assign(new Error('Connection terminated unexpectedly'), {
      code: 'CONNECTION_CLOSED',
    })
    mockExecuteWorkflowCore.mockRejectedValue(infraError)
    mockWasExecutionFinalizedByCore.mockReturnValue(false)

    await expect(executeWebhookJob(payload)).rejects.toBe(infraError)

    expect(mockEnqueue).not.toHaveBeenCalled()
    // Post-core failures keep recording the terminal row.
    expect(loggingSessionMockFns.mockSafeCompleteWithError).toHaveBeenCalled()
  })

  it('faults the run and restores the terminal log row when the requeue enqueue itself fails', async () => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: {
        message: 'Internal error while fetching workflow',
        statusCode: 500,
        retryable: true,
      },
    })
    mockEnqueue.mockRejectedValueOnce(new Error('trigger api unavailable'))

    await expect(executeWebhookJob(payload)).rejects.toThrow(
      'Internal error while fetching workflow'
    )

    // The retry-bound attempt suppressed its failure row; a failed requeue means
    // no retry will run, so the terminal row must be written before faulting.
    expect(loggingSessionMockFns.mockSafeStart).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', workspaceId: 'workspace-1' })
    )
    expect(loggingSessionMockFns.mockSafeCompleteWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'Internal error while fetching workflow' }),
      })
    )
  })
})
