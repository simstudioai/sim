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
} = vi.hoisted(() => ({
  mockResolveWebhookRecordProviderConfig: vi.fn(),
  mockExecuteWorkflowCore: vi.fn(),
  mockWasExecutionFinalizedByCore: vi.fn(),
  mockExecuteWithIdempotency: vi.fn(),
  mockRefreshExecutionSlotExpiry: vi.fn().mockResolvedValue(true),
  mockReleaseExecutionSlot: vi.fn(),
  mockGetProviderHandler: vi.fn(() => ({})),
  mockSetResolvedSecretTraceRegistry: vi.fn(),
  mockLoadDeploymentVersionState: vi.fn(
    async (_workflowId: string, deploymentVersionId: string) => ({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      deploymentVersionId,
    })
  ),
}))

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
  ExecutionSnapshot: class {},
}))

vi.mock('@/tools/safe-assign', () => ({ safeAssign: vi.fn() }))

vi.mock('@/blocks', () => ({ getBlock: vi.fn(() => null) }))

vi.mock('@/triggers', () => ({
  getTrigger: vi.fn(),
  isTriggerValid: vi.fn(() => false),
}))

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
})
