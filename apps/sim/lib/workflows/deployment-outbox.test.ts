/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockPrepareWebhooks,
  mockGetDeploymentOperation,
  mockMarkDeploymentComponentReadiness,
  mockBeginDeploymentOperationActivation,
  mockActivateDeploymentOperation,
  mockMarkDeploymentOperationFailed,
  mockRecordDeploymentOperationRetry,
  mockIsDeploymentOperationCurrent,
  mockIsDeploymentVersionProtectedByCurrentOperation,
  mockCreateSchedulesForDeploy,
  mockSyncMcpToolsForWorkflow,
  mockNotifyMcpToolServers,
  mockSetWorkflowMcpTransactionLockTimeout,
  mockCleanupWebhooksForWorkflow,
  mockActivateWebhookRegistrations,
  mockCleanupRetiredWebhookRegistrations,
  mockRecordAudit,
  mockEmitWorkflowDeployedEvent,
  mockCaptureServerEvent,
  mockCleanupInactiveDeploymentWebhooks,
  mockDeleteInactiveDeploymentSchedules,
  mockGetProtectedDeploymentVersionId,
  mockTx,
} = vi.hoisted(() => ({
  mockPrepareWebhooks: vi.fn(),
  mockGetDeploymentOperation: vi.fn(),
  mockMarkDeploymentComponentReadiness: vi.fn(),
  mockBeginDeploymentOperationActivation: vi.fn(),
  mockActivateDeploymentOperation: vi.fn(),
  mockMarkDeploymentOperationFailed: vi.fn(),
  mockRecordDeploymentOperationRetry: vi.fn(),
  mockIsDeploymentOperationCurrent: vi.fn(),
  mockIsDeploymentVersionProtectedByCurrentOperation: vi.fn(),
  mockCreateSchedulesForDeploy: vi.fn(),
  mockSyncMcpToolsForWorkflow: vi.fn(),
  mockNotifyMcpToolServers: vi.fn(),
  mockSetWorkflowMcpTransactionLockTimeout: vi.fn(),
  mockCleanupWebhooksForWorkflow: vi.fn(),
  mockActivateWebhookRegistrations: vi.fn(),
  mockCleanupRetiredWebhookRegistrations: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockEmitWorkflowDeployedEvent: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
  mockCleanupInactiveDeploymentWebhooks: vi.fn(),
  mockDeleteInactiveDeploymentSchedules: vi.fn(),
  mockGetProtectedDeploymentVersionId: vi.fn(),
  mockTx: { select: vi.fn(), update: vi.fn(), execute: vi.fn() },
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    WORKFLOW_DEPLOYED: 'WORKFLOW_DEPLOYED',
    WORKFLOW_DEPLOYMENT_ACTIVATED: 'WORKFLOW_DEPLOYMENT_ACTIVATED',
  },
  AuditResourceType: { WORKFLOW: 'WORKFLOW' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@/lib/core/outbox/service', () => ({
  continueOutboxHandler: (reason: string) => ({
    outcome: 'deferred',
    reason,
    consumeAttempt: false,
  }),
  enqueueOutboxEvent: vi.fn(),
  processOutboxEventById: vi.fn(),
}))

vi.mock('@/lib/mcp/server-locks', () => ({
  setWorkflowMcpTransactionLockTimeout: mockSetWorkflowMcpTransactionLockTimeout,
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

vi.mock('@/lib/mcp/workflow-mcp-sync', () => ({
  notifyMcpToolServers: mockNotifyMcpToolServers,
  removeMcpToolsForWorkflow: vi.fn(),
  syncMcpToolsForWorkflow: mockSyncMcpToolsForWorkflow,
}))

vi.mock('@/lib/webhooks/deploy', () => ({
  cleanupInactiveDeploymentWebhooks: mockCleanupInactiveDeploymentWebhooks,
  cleanupWebhooksForWorkflow: mockCleanupWebhooksForWorkflow,
  prepareStableTriggerWebhooksForDeploy: vi.fn(),
  saveTriggerWebhooksForDeploy: vi.fn(),
}))

vi.mock('@/lib/webhooks/registration-service', () => ({
  cleanupRetiredWebhookRegistrationsAfterActivation: mockCleanupRetiredWebhookRegistrations,
}))

vi.mock('@/lib/webhooks/registration-store', () => ({
  activateWebhookRegistrations: mockActivateWebhookRegistrations,
}))

vi.mock('@/lib/workflows/persistence/deployment-operations', () => ({
  activateDeploymentOperation: mockActivateDeploymentOperation,
  beginDeploymentOperationActivation: mockBeginDeploymentOperationActivation,
  getDeploymentOperation: mockGetDeploymentOperation,
  getProtectedDeploymentVersionId: mockGetProtectedDeploymentVersionId,
  isDeploymentOperationCurrent: mockIsDeploymentOperationCurrent,
  isDeploymentVersionProtectedByCurrentOperation:
    mockIsDeploymentVersionProtectedByCurrentOperation,
  markDeploymentComponentReadiness: mockMarkDeploymentComponentReadiness,
  markDeploymentOperationFailed: mockMarkDeploymentOperationFailed,
  recordDeploymentOperationRetry: mockRecordDeploymentOperationRetry,
  setDeploymentTxTimeouts: vi.fn(),
}))

vi.mock('@/lib/workflows/schedules', () => ({
  createSchedulesForDeploy: mockCreateSchedulesForDeploy,
  deleteInactiveDeploymentSchedules: mockDeleteInactiveDeploymentSchedules,
  deleteSchedulesForWorkflow: vi.fn(),
}))

vi.mock('@/lib/workspace-events/emitter', () => ({
  emitWorkflowDeployedEvent: mockEmitWorkflowDeployedEvent,
}))

import type { OutboxEventContext } from '@/lib/core/outbox/service'
import { NonRetryableDeploymentError } from '@/lib/workflows/deployment-lifecycle'
import {
  createWorkflowDeploymentOutboxHandlers,
  type PrepareDeploymentV2Payload,
  WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS,
} from '@/lib/workflows/deployment-outbox'

const NOW = new Date('2026-07-14T08:00:00.000Z')

function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'operation-1',
    workflowId: 'workflow-1',
    deploymentVersionId: 'version-2',
    version: 2,
    previousActiveVersionId: 'version-1',
    action: 'deploy' as const,
    protocolVersion: 2,
    generation: 2,
    status: 'preparing' as const,
    componentReadiness: {
      webhooks: { status: 'pending', updatedAt: NOW.toISOString() },
      schedules: { status: 'pending', updatedAt: NOW.toISOString() },
      mcp: { status: 'pending', updatedAt: NOW.toISOString() },
    },
    errorCode: null,
    errorMessage: null,
    idempotencyKey: 'request-1',
    requestHash: 'hash',
    actorId: 'user-1',
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function payload(): PrepareDeploymentV2Payload {
  return {
    protocolVersion: 2,
    operationId: 'operation-1',
    generation: 2,
    workflowId: 'workflow-1',
    deploymentVersionId: 'version-2',
    version: 2,
    userId: 'user-1',
    requestId: 'request-1',
    checkpoints: {},
  }
}

function context(controller = new AbortController(), attempts = 0): OutboxEventContext {
  return {
    eventId: 'event-1',
    eventType: WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.PREPARE_V2,
    attempts,
    maxAttempts: 4,
    signal: controller.signal,
    checkpointPayload: vi.fn().mockResolvedValue(undefined),
  }
}

function handler() {
  return createWorkflowDeploymentOutboxHandlers({
    prepareWebhooks: mockPrepareWebhooks,
  })[WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.PREPARE_V2]
}

afterAll(() => {
  resetDbChainMock()
})

describe('versioned deployment preparation outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    /**
     * These handlers only reach db.transaction in deferred cleanup helpers the
     * suite intentionally keeps inert (the previous private factory returned
     * undefined without running the callback); the default chain-mock
     * transaction would execute the callback and consume queued select rows.
     */
    dbChainMockFns.transaction.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    mockPrepareWebhooks.mockResolvedValue(undefined)
    mockActivateWebhookRegistrations.mockResolvedValue(undefined)
    mockCleanupRetiredWebhookRegistrations.mockResolvedValue(undefined)
    mockCreateSchedulesForDeploy.mockResolvedValue({ success: true })
    mockSyncMcpToolsForWorkflow.mockResolvedValue([{ serverId: 'mcp-server-1' }])
    mockSetWorkflowMcpTransactionLockTimeout.mockResolvedValue(undefined)
    mockEmitWorkflowDeployedEvent.mockResolvedValue(undefined)
    mockCaptureServerEvent.mockReturnValue(undefined)
    mockMarkDeploymentOperationFailed.mockResolvedValue({
      success: true,
      operation: operation({ status: 'failed' }),
    })
    mockIsDeploymentOperationCurrent.mockResolvedValue(false)
    mockIsDeploymentVersionProtectedByCurrentOperation.mockResolvedValue(false)
    mockGetProtectedDeploymentVersionId.mockResolvedValue(null)
    mockDeleteInactiveDeploymentSchedules.mockResolvedValue({ status: 'deleted', count: 0 })
    mockCleanupInactiveDeploymentWebhooks.mockResolvedValue({ hasMore: false })
  })

  it('activates only after every preparation component is ready', async () => {
    /** Nothing newer has been enqueued, so this deploy owns its generation. */
    mockIsDeploymentOperationCurrent.mockResolvedValue(true)
    const preparing = operation()
    const webhooksReady = operation({
      componentReadiness: {
        ...preparing.componentReadiness,
        webhooks: { status: 'ready', updatedAt: NOW.toISOString() },
      },
    })
    const schedulesReady = operation({
      componentReadiness: {
        ...webhooksReady.componentReadiness,
        schedules: { status: 'ready', updatedAt: NOW.toISOString() },
      },
    })
    const allReady = operation({
      componentReadiness: {
        ...schedulesReady.componentReadiness,
        mcp: { status: 'ready', updatedAt: NOW.toISOString() },
      },
    })
    const activating = operation({
      status: 'activating',
      componentReadiness: allReady.componentReadiness,
    })
    const active = operation({
      status: 'active',
      componentReadiness: allReady.componentReadiness,
      completedAt: NOW,
    })
    mockGetDeploymentOperation.mockResolvedValue(preparing)
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])
    queueTableRows(schemaMock.workflowDeploymentVersion, [
      { id: 'version-2', state: { blocks: {} } },
    ])
    mockMarkDeploymentComponentReadiness
      .mockResolvedValueOnce({ success: true, operation: webhooksReady })
      .mockResolvedValueOnce({ success: true, operation: schedulesReady })
      .mockResolvedValueOnce({ success: true, operation: allReady })
    mockBeginDeploymentOperationActivation.mockResolvedValue({
      success: true,
      operation: activating,
    })
    mockActivateDeploymentOperation.mockImplementation(async (input) => {
      await input.onActivateTransaction?.(mockTx, active)
      return { success: true, operation: active }
    })

    await handler()(payload(), context())

    expect(mockPrepareWebhooks).toHaveBeenCalledTimes(1)
    expect(mockCreateSchedulesForDeploy).toHaveBeenCalledWith(
      'workflow-1',
      {},
      undefined,
      'version-2',
      'operation-1'
    )
    expect(
      mockMarkDeploymentComponentReadiness.mock.calls.map(([input]) => input.component)
    ).toEqual(['webhooks', 'schedules', 'mcp'])
    expect(mockSyncMcpToolsForWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        tx: mockTx,
        notify: false,
        state: { blocks: {} },
      })
    )
    expect(mockActivateWebhookRegistrations).toHaveBeenCalledWith(mockTx, {
      workflowId: 'workflow-1',
      operationId: 'operation-1',
      generation: 2,
      deploymentVersionId: 'version-2',
    })
    expect(mockCleanupRetiredWebhookRegistrations).toHaveBeenCalledTimes(1)
    expect(mockNotifyMcpToolServers).toHaveBeenCalledWith([{ serverId: 'mcp-server-1' }])
    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(
      'user-1',
      'workflow_deployed',
      { workflow_id: 'workflow-1', workspace_id: 'workspace-1' },
      expect.objectContaining({
        insertId: 'event-1',
        groups: { workspace: 'workspace-1' },
        setOnce: expect.objectContaining({ first_workflow_deployed_at: expect.any(String) }),
      })
    )
    expect(mockEmitWorkflowDeployedEvent).toHaveBeenCalledTimes(1)
    expect(mockRecordAudit.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockActivateDeploymentOperation.mock.invocationCallOrder[0]
    )
    expect(mockCaptureServerEvent.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockActivateDeploymentOperation.mock.invocationCallOrder[0]
    )

    /**
     * The resume re-enters post-activation work, so the checkpoints — not the
     * generation fence — are what must keep analytics from being captured
     * twice.
     */
    mockGetDeploymentOperation.mockResolvedValue(active)
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])
    await handler()(
      {
        ...payload(),
        checkpoints: {
          inactiveCleanupCompleted: true,
          auditEmitted: true,
          analyticsCaptured: true,
          socketNotified: true,
          workspaceEventEmitted: true,
        },
      },
      context()
    )
    expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1)
  })

  it('ignores a superseded generation without preparing side effects', async () => {
    mockGetDeploymentOperation.mockResolvedValue(operation({ status: 'superseded' }))

    await handler()(payload(), context())

    expect(mockPrepareWebhooks).not.toHaveBeenCalled()
    expect(mockCreateSchedulesForDeploy).not.toHaveBeenCalled()
    expect(mockMarkDeploymentComponentReadiness).not.toHaveBeenCalled()
    expect(mockActivateDeploymentOperation).not.toHaveBeenCalled()
  })

  /**
   * Analytics was briefly flushed durably here, which put a deploy's audit
   * trail, socket notification, and subscription cleanup behind PostHog and
   * retried the event until it dead-lettered. Capture is fire-and-forget
   * again: the checkpoint advances on capture, and everything the cutover
   * actually owes still runs. `captureServerEvent` swallowing its own
   * failures is pinned in `lib/posthog/server.test.ts`.
   */
  it('checkpoints analytics on capture and still finishes the deploy', async () => {
    mockIsDeploymentOperationCurrent.mockResolvedValue(true)
    mockGetDeploymentOperation.mockResolvedValue(operation({ status: 'active', completedAt: NOW }))
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])
    const outboxContext = context()

    await expect(
      handler()(
        {
          ...payload(),
          checkpoints: { inactiveCleanupCompleted: true, auditEmitted: true },
        },
        outboxContext
      )
    ).resolves.toBeUndefined()

    expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1)
    expect(outboxContext.checkpointPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoints: expect.objectContaining({ analyticsCaptured: true }),
      })
    )
    expect(mockEmitWorkflowDeployedEvent).toHaveBeenCalledTimes(1)
    expect(mockCleanupRetiredWebhookRegistrations).toHaveBeenCalledTimes(1)
  })

  it('honors an aborted signal before starting any side effect', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(handler()(payload(), context(controller))).rejects.toMatchObject({
      name: 'AbortError',
    })

    expect(mockGetDeploymentOperation).not.toHaveBeenCalled()
    expect(mockPrepareWebhooks).not.toHaveBeenCalled()
  })

  it('generation-guards failure on the final outbox attempt', async () => {
    const preparing = operation()
    mockGetDeploymentOperation.mockResolvedValue(preparing)
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])
    queueTableRows(schemaMock.workflowDeploymentVersion, [
      { id: 'version-2', state: { blocks: {} } },
    ])
    mockPrepareWebhooks.mockRejectedValue(new Error('provider unavailable'))

    await expect(handler()(payload(), context(new AbortController(), 3))).rejects.toThrow(
      'provider unavailable'
    )

    expect(mockMarkDeploymentOperationFailed).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      operationId: 'operation-1',
      generation: 2,
      error: expect.objectContaining({ message: 'provider unavailable' }),
      errorCode: 'preparation_failed',
    })
    expect(mockActivateDeploymentOperation).not.toHaveBeenCalled()
  })

  it('retries transient mid-attempt failures without failing the operation', async () => {
    const preparing = operation()
    mockGetDeploymentOperation.mockResolvedValue(preparing)
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])
    queueTableRows(schemaMock.workflowDeploymentVersion, [
      { id: 'version-2', state: { blocks: {} } },
    ])
    mockPrepareWebhooks.mockRejectedValue(new Error('provider briefly unavailable'))

    await expect(handler()(payload(), context(new AbortController(), 0))).rejects.toThrow(
      'provider briefly unavailable'
    )

    expect(mockMarkDeploymentOperationFailed).not.toHaveBeenCalled()
    expect(mockRecordDeploymentOperationRetry).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      operationId: 'operation-1',
      generation: 2,
      error: expect.objectContaining({ message: 'provider briefly unavailable' }),
    })
    expect(mockActivateDeploymentOperation).not.toHaveBeenCalled()
  })

  it('skips checkpointed webhook preparation on resume without re-running provider work', async () => {
    const preparing = operation()
    const webhooksReady = operation({
      componentReadiness: {
        ...preparing.componentReadiness,
        webhooks: { status: 'ready', updatedAt: NOW.toISOString() },
      },
    })
    const schedulesReady = operation({
      componentReadiness: {
        ...webhooksReady.componentReadiness,
        schedules: { status: 'ready', updatedAt: NOW.toISOString() },
      },
    })
    const allReady = operation({
      componentReadiness: {
        ...schedulesReady.componentReadiness,
        mcp: { status: 'ready', updatedAt: NOW.toISOString() },
      },
    })
    mockGetDeploymentOperation.mockResolvedValue(preparing)
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])
    queueTableRows(schemaMock.workflowDeploymentVersion, [
      { id: 'version-2', state: { blocks: {} } },
    ])
    mockMarkDeploymentComponentReadiness
      .mockResolvedValueOnce({ success: true, operation: webhooksReady })
      .mockResolvedValueOnce({ success: true, operation: schedulesReady })
      .mockResolvedValueOnce({ success: true, operation: allReady })
    mockBeginDeploymentOperationActivation.mockResolvedValue({
      success: true,
      operation: operation({
        status: 'activating',
        componentReadiness: allReady.componentReadiness,
      }),
    })
    mockActivateDeploymentOperation.mockResolvedValue({
      success: true,
      operation: operation({
        status: 'active',
        componentReadiness: allReady.componentReadiness,
        completedAt: NOW,
      }),
    })

    const resumedPayload = { ...payload(), checkpoints: { webhooksPrepared: true } }
    await handler()(resumedPayload, context())

    expect(mockPrepareWebhooks).not.toHaveBeenCalled()
    expect(mockCreateSchedulesForDeploy).toHaveBeenCalledTimes(1)
    expect(mockMarkDeploymentComponentReadiness.mock.calls[0][0]).toEqual(
      expect.objectContaining({ component: 'webhooks', status: 'ready' })
    )
  })

  it('fails the operation immediately on a non-retryable preparation error', async () => {
    const preparing = operation()
    mockGetDeploymentOperation.mockResolvedValue(preparing)
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])
    queueTableRows(schemaMock.workflowDeploymentVersion, [
      { id: 'version-2', state: { blocks: {} } },
    ])
    mockPrepareWebhooks.mockRejectedValue(
      new NonRetryableDeploymentError(
        'Webhook path "/leads" is already in use. Choose a different path.',
        'webhook_path_conflict'
      )
    )

    await expect(handler()(payload(), context())).resolves.toBeUndefined()

    expect(mockMarkDeploymentOperationFailed).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      operationId: 'operation-1',
      generation: 2,
      error: expect.objectContaining({
        message: 'Webhook path "/leads" is already in use. Choose a different path.',
      }),
      errorCode: 'webhook_path_conflict',
    })
    expect(mockActivateDeploymentOperation).not.toHaveBeenCalled()
  })

  /**
   * The production shape: an attempt activates, its post-activation phase is
   * interrupted (handler timeout), and a redeploy lands before the reaper
   * requeues it. Every resumed attempt then re-fails the same generation
   * fence, so without the guard it exhausts the retry budget and dead-letters.
   */
  it('skips the fenced cleanup once a newer deploy supersedes an activated attempt', async () => {
    mockGetDeploymentOperation.mockResolvedValue(operation({ status: 'active', completedAt: NOW }))
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])
    mockCleanupRetiredWebhookRegistrations.mockRejectedValue(
      new Error('Webhook registration operation is stale')
    )

    await expect(handler()(payload(), context(new AbortController(), 3))).resolves.toBeUndefined()

    expect(mockCleanupRetiredWebhookRegistrations).not.toHaveBeenCalled()
    expect(mockDeleteInactiveDeploymentSchedules).not.toHaveBeenCalled()
    expect(mockCleanupInactiveDeploymentWebhooks).not.toHaveBeenCalled()
    expect(mockMarkDeploymentOperationFailed).not.toHaveBeenCalled()
    expect(mockRecordDeploymentOperationRetry).not.toHaveBeenCalled()
  })

  /**
   * `isDeploymentOperationCurrent` goes false the moment any newer generation
   * row exists, including one still `preparing` or already `failed`. This
   * activation is the live cutover in that window and no newer attempt will
   * adopt its notifications, so the fence must cost it only the cleanup.
   */
  it('still notifies when the newer generation has not activated', async () => {
    mockGetDeploymentOperation.mockResolvedValue(operation({ status: 'active', completedAt: NOW }))
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])

    await expect(handler()(payload(), context())).resolves.toBeUndefined()

    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1)
    expect(mockEmitWorkflowDeployedEvent).toHaveBeenCalledTimes(1)
    expect(mockCleanupRetiredWebhookRegistrations).not.toHaveBeenCalled()
  })

  it('resumes post-activation work while the activated attempt is still current', async () => {
    mockIsDeploymentOperationCurrent.mockResolvedValue(true)
    mockGetDeploymentOperation.mockResolvedValue(operation({ status: 'active', completedAt: NOW }))
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])

    const outboxContext = context()

    await expect(handler()(payload(), outboxContext)).resolves.toBeUndefined()

    expect(mockCleanupRetiredWebhookRegistrations).toHaveBeenCalledTimes(1)
    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(mockEmitWorkflowDeployedEvent).toHaveBeenCalledTimes(1)
    expect(mockDeleteInactiveDeploymentSchedules).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      operationFence: {
        workflowId: 'workflow-1',
        operationId: 'operation-1',
        generation: 2,
        deploymentVersionId: 'version-2',
        statuses: ['active'],
      },
    })
    expect(mockCleanupInactiveDeploymentWebhooks).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        protectedDeploymentVersionId: null,
        limit: 20,
      })
    )
    expect(outboxContext.checkpointPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoints: expect.objectContaining({ inactiveCleanupCompleted: true }),
      })
    )
  })

  /**
   * Retiring the previous generation's provider subscriptions is the slowest
   * step after cutover; a deploy that already went live must not lose its
   * audit trail or its "deployment changed" notification when that step fails.
   */
  it('records and notifies an activated deploy before retiring old subscriptions', async () => {
    mockIsDeploymentOperationCurrent.mockResolvedValue(true)
    mockGetDeploymentOperation.mockResolvedValue(operation({ status: 'active', completedAt: NOW }))
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])
    mockCleanupRetiredWebhookRegistrations.mockRejectedValue(new Error('provider unavailable'))

    await expect(handler()(payload(), context())).rejects.toThrow('provider unavailable')

    expect(mockRecordAudit).toHaveBeenCalledTimes(1)
    expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1)
    expect(mockEmitWorkflowDeployedEvent).toHaveBeenCalledTimes(1)
    expect(mockRecordAudit.mock.invocationCallOrder[0]).toBeLessThan(
      mockCleanupRetiredWebhookRegistrations.mock.invocationCallOrder[0]
    )
  })

  it('continues through the outbox while stale webhooks remain, then checkpoints the cleanup', async () => {
    mockIsDeploymentOperationCurrent.mockResolvedValue(true)
    mockGetDeploymentOperation.mockResolvedValue(operation({ status: 'active', completedAt: NOW }))
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])
    mockCleanupInactiveDeploymentWebhooks.mockResolvedValueOnce({ hasMore: true })
    const outboxContext = context()

    await expect(handler()(payload(), outboxContext)).resolves.toEqual({
      outcome: 'deferred',
      reason: expect.any(String),
      consumeAttempt: false,
    })
    expect(outboxContext.checkpointPayload).not.toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoints: expect.objectContaining({ inactiveCleanupCompleted: true }),
      })
    )

    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])
    await expect(handler()(payload(), outboxContext)).resolves.toBeUndefined()

    expect(mockDeleteInactiveDeploymentSchedules).toHaveBeenCalledTimes(2)
    expect(mockCleanupInactiveDeploymentWebhooks).toHaveBeenCalledTimes(2)
    expect(outboxContext.checkpointPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoints: expect.objectContaining({ inactiveCleanupCompleted: true }),
      })
    )
  })

  it('stops legacy inactive cleanup as soon as its lease is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const cleanupHandler =
      createWorkflowDeploymentOutboxHandlers()[
        WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.CLEANUP_INACTIVE_SIDE_EFFECTS
      ]

    await expect(
      cleanupHandler(
        { workflowId: 'workflow-1', activeDeploymentVersionId: 'version-2', userId: 'user-1' },
        context(controller)
      )
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(mockDeleteInactiveDeploymentSchedules).not.toHaveBeenCalled()
    expect(mockCleanupInactiveDeploymentWebhooks).not.toHaveBeenCalled()
  })

  it('retires undeployed side effects by row and shields the candidate owned by the current v2 operation', async () => {
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])
    queueTableRows(schemaMock.workflow, [{ isDeployed: true }])
    mockGetProtectedDeploymentVersionId.mockResolvedValue('version-2')
    const cleanupHandler =
      createWorkflowDeploymentOutboxHandlers()[
        WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.CLEANUP_UNDEPLOYED_SIDE_EFFECTS
      ]

    await expect(
      cleanupHandler(
        {
          workflowId: 'workflow-1',
          deploymentVersionIds: ['version-2'],
          userId: 'user-1',
          requestId: 'request-1',
        },
        context()
      )
    ).resolves.toBeUndefined()

    expect(mockDeleteInactiveDeploymentSchedules).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      operationFence: undefined,
    })
    expect(mockCleanupInactiveDeploymentWebhooks).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        protectedDeploymentVersionId: 'version-2',
        limit: 20,
      })
    )
    expect(mockCleanupWebhooksForWorkflow).not.toHaveBeenCalled()
    expect(mockCreateSchedulesForDeploy).not.toHaveBeenCalled()
  })

  it('continues undeploy cleanup through the outbox before touching MCP tools', async () => {
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])
    mockCleanupInactiveDeploymentWebhooks.mockResolvedValueOnce({ hasMore: true })
    const cleanupHandler =
      createWorkflowDeploymentOutboxHandlers()[
        WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.CLEANUP_UNDEPLOYED_SIDE_EFFECTS
      ]

    await expect(
      cleanupHandler({ workflowId: 'workflow-1', userId: 'user-1' }, context())
    ).resolves.toEqual({
      outcome: 'deferred',
      reason: expect.any(String),
      consumeAttempt: false,
    })

    expect(mockNotifyMcpToolServers).not.toHaveBeenCalled()
  })
})
