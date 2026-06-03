/**
 * @vitest-environment node
 */

import {
  dbChainMock,
  dbChainMockFns,
  executionPreprocessingMock,
  executionPreprocessingMockFns,
  loggingSessionMock,
  loggingSessionMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockResolveWebhookRecordProviderConfig,
  mockExecuteWorkflowCore,
  mockWasExecutionFinalizedByCore,
  mockRecordException,
  mockGetActiveSpan,
} = vi.hoisted(() => ({
  mockResolveWebhookRecordProviderConfig: vi.fn(),
  mockExecuteWorkflowCore: vi.fn(),
  mockWasExecutionFinalizedByCore: vi.fn(),
  mockRecordException: vi.fn(),
  mockGetActiveSpan: vi.fn(),
}))

vi.mock('@opentelemetry/api', () => ({
  trace: { getActiveSpan: mockGetActiveSpan },
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)
vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)

vi.mock('@/lib/webhooks/env-resolver', () => ({
  resolveWebhookRecordProviderConfig: mockResolveWebhookRecordProviderConfig,
}))

vi.mock('@/lib/workflows/executor/execution-core', () => ({
  executeWorkflowCore: mockExecuteWorkflowCore,
  wasExecutionFinalizedByCore: mockWasExecutionFinalizedByCore,
}))

vi.mock('@/lib/core/idempotency', () => ({
  IdempotencyService: { createWebhookIdempotencyKey: vi.fn(() => 'idempotency-key') },
  webhookIdempotency: {
    executeWithIdempotency: vi.fn(
      (_provider: string, _key: string, operation: () => Promise<unknown>) => operation()
    ),
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
}))

vi.mock('@/lib/webhooks/providers', () => ({
  getProviderHandler: vi.fn(() => ({})),
}))

vi.mock('@/lib/logs/execution/trace-spans/trace-spans', () => ({
  buildTraceSpans: vi.fn(() => ({ traceSpans: [] })),
}))

vi.mock('@/lib/core/execution-limits', () => ({
  createTimeoutAbortController: vi.fn(() => ({
    signal: new AbortController().signal,
    cleanup: vi.fn(),
    isTimedOut: () => false,
    timeoutMs: 120_000,
  })),
  getTimeoutErrorMessage: vi.fn(() => 'timed out'),
}))

vi.mock('@/lib/workflows/executor/pause-persistence', () => ({
  handlePostExecutionPauseState: vi.fn(),
}))

vi.mock('@/lib/webhooks/attachment-processor', () => ({
  WebhookAttachmentProcessor: class {},
}))

vi.mock('@/app/api/auth/oauth/utils', () => ({
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

import { executeWebhookJob, resolveWebhookExecutionProviderConfig } from './webhook-execution'

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
  const payload = {
    webhookId: 'webhook-1',
    workflowId: 'workflow-1',
    userId: 'user-1',
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
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValue({
      success: true,
      workflowRecord: { workspaceId: 'workspace-1', userId: 'user-1', variables: {} },
      executionTimeout: { async: 120_000 },
    })
    mockResolveWebhookRecordProviderConfig.mockImplementation(async (record) => record)
    dbChainMockFns.limit.mockResolvedValue([{ id: 'webhook-1' }])
    mockGetActiveSpan.mockReturnValue({ recordException: mockRecordException })
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
    // The error is still recorded on the run span so it stays visible in traces.
    expect(mockRecordException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Gmail 2 is missing required fields: Label' })
    )
  })

  it('faults the run (re-throws) when the failure was not finalized by core', async () => {
    mockExecuteWorkflowCore.mockRejectedValue(new Error('Workflow state not found'))
    mockWasExecutionFinalizedByCore.mockReturnValue(false)

    await expect(executeWebhookJob(payload)).rejects.toThrow('Workflow state not found')
    // waitForPostExecution must run on every path so the finalized-by-core signal is always reliable.
    expect(loggingSessionMockFns.mockWaitForPostExecution).toHaveBeenCalled()
    // Pipeline/infra errors are recorded here before re-throwing to fault the trigger.dev run.
    expect(loggingSessionMockFns.mockSafeCompleteWithError).toHaveBeenCalled()
  })
})
