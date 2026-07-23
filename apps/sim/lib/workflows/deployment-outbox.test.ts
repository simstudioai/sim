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
    mockMarkDeploymentOperationFailed.mockResolvedValue({
      success: true,
      operation: operation({ status: 'failed' }),
    })
    mockIsDeploymentOperationCurrent.mockResolvedValue(false)
    mockIsDeploymentVersionProtectedByCurrentOperation.mockResolvedValue(false)
  })

  it('activates only after every preparation component is ready', async () => {
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
        groups: { workspace: 'workspace-1' },
        setOnce: expect.objectContaining({ first_workflow_deployed_at: expect.any(String) }),
      })
    )
    expect(mockEmitWorkflowDeployedEvent).toHaveBeenCalledTimes(1)
    expect(mockRecordAudit.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockActivateDeploymentOperation.mock.invocationCallOrder[0]
    )
  })

  it('ignores a superseded generation without preparing side effects', async () => {
    mockGetDeploymentOperation.mockResolvedValue(operation({ status: 'superseded' }))

    await handler()(payload(), context())

    expect(mockPrepareWebhooks).not.toHaveBeenCalled()
    expect(mockCreateSchedulesForDeploy).not.toHaveBeenCalled()
    expect(mockMarkDeploymentComponentReadiness).not.toHaveBeenCalled()
    expect(mockActivateDeploymentOperation).not.toHaveBeenCalled()
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

  it('keeps v1 cleanup from deleting a candidate owned by the current v2 operation', async () => {
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    ])
    queueTableRows(schemaMock.workflowDeploymentVersion, [{ isActive: false }])
    queueTableRows(schemaMock.workflow, [{ isDeployed: true }])
    mockIsDeploymentVersionProtectedByCurrentOperation.mockResolvedValue(true)
    const cleanupHandler =
      createWorkflowDeploymentOutboxHandlers()[
        WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.CLEANUP_UNDEPLOYED_SIDE_EFFECTS
      ]

    await cleanupHandler(
      {
        workflowId: 'workflow-1',
        deploymentVersionIds: ['version-2'],
        userId: 'user-1',
        requestId: 'request-1',
      },
      context()
    )

    expect(mockCleanupWebhooksForWorkflow).not.toHaveBeenCalled()
    expect(mockCreateSchedulesForDeploy).not.toHaveBeenCalled()
  })
})
