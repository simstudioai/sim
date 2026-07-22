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
  mockSaveWorkflowToNormalizedTables,
  mockRecordAudit,
  mockCaptureServerEvent,
  mockValidateWorkflowSchedules,
  mockValidateTriggerWebhookConfigForDeploy,
  mockEmitWorkflowDeployedEvent,
  mockPrepareWorkflowDeployment,
  mockPrepareWorkflowVersionActivation,
  mockGetWorkflowDeploymentStatus,
  mockEnqueueWorkflowDeploymentPreparation,
  mockProcessWorkflowDeploymentOutboxEvent,
  mockNotifySocketDeploymentChanged,
  mockLoadWorkflowDeploymentSnapshot,
  mockTx,
} = vi.hoisted(() => ({
  mockSaveWorkflowToNormalizedTables: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
  mockValidateWorkflowSchedules: vi.fn(),
  mockValidateTriggerWebhookConfigForDeploy: vi.fn(),
  mockEmitWorkflowDeployedEvent: vi.fn(),
  mockPrepareWorkflowDeployment: vi.fn(),
  mockPrepareWorkflowVersionActivation: vi.fn(),
  mockGetWorkflowDeploymentStatus: vi.fn(),
  mockEnqueueWorkflowDeploymentPreparation: vi.fn(),
  mockProcessWorkflowDeploymentOutboxEvent: vi.fn(),
  mockNotifySocketDeploymentChanged: vi.fn(),
  mockLoadWorkflowDeploymentSnapshot: vi.fn(),
  /**
   * Sentinel transaction handle the mocked prepare functions hand to the real
   * onPrepareTransaction callback, which only forwards it into the (mocked)
   * outbox enqueue — identity is asserted, never chained on.
   */
  mockTx: { sentinel: 'tx' },
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    WORKFLOW_DEPLOYMENT_REVERTED: 'WORKFLOW_DEPLOYMENT_REVERTED',
    WORKFLOW_DEPLOYED: 'WORKFLOW_DEPLOYED',
    WORKFLOW_UNDEPLOYED: 'WORKFLOW_UNDEPLOYED',
    WORKFLOW_DEPLOYMENT_ACTIVATED: 'WORKFLOW_DEPLOYMENT_ACTIVATED',
  },
  AuditResourceType: { WORKFLOW: 'WORKFLOW' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@/lib/workflows/deployment-outbox', () => ({
  enqueueWorkflowDeploymentPreparation: mockEnqueueWorkflowDeploymentPreparation,
  enqueueWorkflowUndeploySideEffects: vi.fn().mockResolvedValue('outbox-2'),
  notifySocketDeploymentChanged: mockNotifySocketDeploymentChanged,
  processWorkflowDeploymentOutboxEvent: mockProcessWorkflowDeploymentOutboxEvent,
  DEPLOYMENT_READINESS_COMPONENTS: ['webhooks', 'schedules', 'mcp'],
}))

vi.mock('@/lib/workflows/persistence/deployment-operations', () => ({
  getWorkflowDeploymentStatus: mockGetWorkflowDeploymentStatus,
  prepareWorkflowDeployment: mockPrepareWorkflowDeployment,
  prepareWorkflowVersionActivation: mockPrepareWorkflowVersionActivation,
}))

vi.mock('@/lib/workspace-events/emitter', () => ({
  emitWorkflowDeployedEvent: mockEmitWorkflowDeployedEvent,
  emitWorkflowUndeployedEvent: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: { INTERNAL_API_SECRET: 'secret' },
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'http://localhost:3000',
  getSocketServerUrl: () => 'http://localhost:3002',
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowDeploymentSnapshot: mockLoadWorkflowDeploymentSnapshot,
  saveWorkflowToNormalizedTables: mockSaveWorkflowToNormalizedTables,
  undeployWorkflow: vi.fn(),
}))

vi.mock('@/lib/webhooks/deploy', () => ({
  validateTriggerWebhookConfigForDeploy: mockValidateTriggerWebhookConfigForDeploy,
}))

vi.mock('@/lib/workflows/schedules', () => ({
  validateWorkflowSchedules: mockValidateWorkflowSchedules,
}))

import {
  performActivateVersion,
  performFullDeploy,
  performRevertToVersion,
} from '@/lib/workflows/orchestration/deploy'

afterAll(() => {
  resetDbChainMock()
})

describe('performRevertToVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
  })

  it('restores variables when the deployment snapshot includes them', async () => {
    queueTableRows(schemaMock.workflowDeploymentVersion, [
      {
        state: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
          variables: {
            variableA: {
              id: 'variableA',
              name: 'API_KEY',
              type: 'plain',
              value: 'deployed-value',
            },
          },
        },
      },
    ])

    const result = await performRevertToVersion({
      workflowId: 'workflow-1',
      version: 3,
      userId: 'user-1',
      workflow: { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    })

    expect(result.success).toBe(true)
    expect(mockSaveWorkflowToNormalizedTables).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({
        variables: {
          variableA: {
            id: 'variableA',
            name: 'API_KEY',
            type: 'plain',
            value: 'deployed-value',
          },
        },
      }),
      dbChainMock.db
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          variableA: {
            id: 'variableA',
            name: 'API_KEY',
            type: 'plain',
            value: 'deployed-value',
          },
        },
      })
    )
  })

  it('preserves existing variables when reverting a legacy snapshot without variables', async () => {
    queueTableRows(schemaMock.workflowDeploymentVersion, [
      {
        state: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
        },
      },
    ])

    const result = await performRevertToVersion({
      workflowId: 'workflow-1',
      version: 2,
      userId: 'user-1',
      workflow: { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
    })

    expect(result.success).toBe(true)
    const savedState = mockSaveWorkflowToNormalizedTables.mock.calls[0][1]
    expect(Object.hasOwn(savedState, 'variables')).toBe(false)
    const workflowUpdate = dbChainMockFns.set.mock.calls[0][0]
    expect(Object.hasOwn(workflowUpdate, 'variables')).toBe(false)
  })
})

describe('performFullDeploy workspace event emission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    const now = new Date('2026-07-14T08:00:00.000Z')
    const operation = {
      id: 'operation-default',
      workflowId: 'workflow-1',
      deploymentVersionId: 'dv-1',
      version: 4,
      previousActiveVersionId: null,
      action: 'deploy',
      protocolVersion: 2,
      generation: 1,
      status: 'active',
      componentReadiness: {
        webhooks: { status: 'ready', updatedAt: now.toISOString() },
        schedules: { status: 'ready', updatedAt: now.toISOString() },
        mcp: { status: 'ready', updatedAt: now.toISOString() },
      },
      errorCode: null,
      errorMessage: null,
      idempotencyKey: 'request-default',
      requestHash: 'hash',
      actorId: 'user-1',
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    mockProcessWorkflowDeploymentOutboxEvent.mockResolvedValue('completed')
    mockNotifySocketDeploymentChanged.mockResolvedValue(undefined)
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'My Workflow', workspaceId: 'workspace-1' },
    ])
    mockLoadWorkflowDeploymentSnapshot.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
      lastSaved: now.getTime(),
    })
    mockValidateWorkflowSchedules.mockReturnValue({ isValid: true })
    mockValidateTriggerWebhookConfigForDeploy.mockResolvedValue({ success: true })
    mockEnqueueWorkflowDeploymentPreparation.mockResolvedValue('prepare-event-default')
    mockPrepareWorkflowDeployment.mockImplementation(async (input) => {
      await input.onPrepareTransaction?.(mockTx, operation)
      return { success: true, operation, reused: false }
    })
    mockGetWorkflowDeploymentStatus.mockResolvedValue({
      activeDeployment: {
        deploymentVersionId: 'dv-1',
        version: 4,
        deployedAt: now,
      },
      latestOperation: operation,
    })
  })

  it('always admits deploys through v2 without legacy immediate activation', async () => {
    const result = await performFullDeploy({
      workflowId: 'workflow-1',
      userId: 'user-1',
    })

    expect(result.success).toBe(true)
    expect(mockPrepareWorkflowDeployment).toHaveBeenCalledTimes(1)
    expect(mockEnqueueWorkflowDeploymentPreparation).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ protocolVersion: 2 })
    )
    expect(mockEmitWorkflowDeployedEvent).not.toHaveBeenCalled()
  })

  it('keeps a first deploy pending without claiming an active deployment', async () => {
    const now = new Date('2026-07-14T08:00:00.000Z')
    const operation = {
      id: 'operation-1',
      workflowId: 'workflow-1',
      deploymentVersionId: 'dv-candidate',
      version: 1,
      previousActiveVersionId: null,
      action: 'deploy',
      protocolVersion: 2,
      generation: 1,
      status: 'preparing',
      componentReadiness: {
        webhooks: { status: 'pending', updatedAt: now.toISOString() },
        schedules: { status: 'pending', updatedAt: now.toISOString() },
        mcp: { status: 'pending', updatedAt: now.toISOString() },
      },
      errorCode: null,
      errorMessage: null,
      idempotencyKey: 'request-1',
      requestHash: 'hash',
      actorId: 'user-1',
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    mockLoadWorkflowDeploymentSnapshot.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
      lastSaved: now.getTime(),
    })
    mockValidateWorkflowSchedules.mockReturnValue({ isValid: true })
    mockValidateTriggerWebhookConfigForDeploy.mockResolvedValue({ success: true })
    mockEnqueueWorkflowDeploymentPreparation.mockResolvedValue('prepare-event-1')
    mockPrepareWorkflowDeployment.mockImplementation(async (input) => {
      await input.onPrepareTransaction?.(mockTx, operation)
      return { success: true, operation, reused: false }
    })
    mockProcessWorkflowDeploymentOutboxEvent.mockResolvedValue('pending')
    mockGetWorkflowDeploymentStatus.mockResolvedValue({
      activeDeployment: null,
      latestOperation: operation,
    })

    const result = await performFullDeploy({
      workflowId: 'workflow-1',
      userId: 'user-1',
      requestId: 'request-1',
    })

    expect(result).toMatchObject({
      success: true,
      activeDeployment: null,
      latestDeploymentAttempt: {
        id: 'operation-1',
        status: 'preparing',
        deploymentVersionId: 'dv-candidate',
      },
      warnings: [expect.stringContaining('workflow remains undeployed')],
    })
    expect(result.deployedAt).toBeUndefined()
  })

  it('preserves the old active deployment while a redeploy prepares', async () => {
    const now = new Date('2026-07-14T08:00:00.000Z')
    const operation = {
      id: 'operation-2',
      workflowId: 'workflow-1',
      deploymentVersionId: 'dv-candidate',
      version: 5,
      previousActiveVersionId: 'dv-live',
      action: 'deploy',
      protocolVersion: 2,
      generation: 2,
      status: 'preparing',
      componentReadiness: {
        webhooks: { status: 'ready', updatedAt: now.toISOString() },
        schedules: { status: 'pending', updatedAt: now.toISOString() },
        mcp: { status: 'pending', updatedAt: now.toISOString() },
      },
      errorCode: null,
      errorMessage: null,
      idempotencyKey: 'request-2',
      requestHash: 'hash',
      actorId: 'user-1',
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    mockLoadWorkflowDeploymentSnapshot.mockResolvedValue({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      variables: {},
      lastSaved: now.getTime(),
    })
    mockValidateWorkflowSchedules.mockReturnValue({ isValid: true })
    mockValidateTriggerWebhookConfigForDeploy.mockResolvedValue({ success: true })
    mockEnqueueWorkflowDeploymentPreparation.mockResolvedValue('prepare-event-2')
    mockPrepareWorkflowDeployment.mockImplementation(async (input) => {
      await input.onPrepareTransaction?.(mockTx, operation)
      return { success: true, operation, reused: false }
    })
    mockProcessWorkflowDeploymentOutboxEvent.mockResolvedValue('pending')
    mockGetWorkflowDeploymentStatus.mockResolvedValue({
      activeDeployment: {
        deploymentVersionId: 'dv-live',
        version: 4,
        deployedAt: now,
      },
      latestOperation: operation,
    })

    const result = await performFullDeploy({
      workflowId: 'workflow-1',
      userId: 'user-1',
      requestId: 'request-2',
    })

    expect(result).toMatchObject({
      success: true,
      /**
       * Top-level version identifies the snapshot this call admitted, while
       * activeDeployment keeps reporting what is actually live during the
       * pending cutover.
       */
      deploymentVersionId: 'dv-candidate',
      version: 5,
      activeDeployment: {
        deploymentVersionId: 'dv-live',
        version: 4,
      },
      latestDeploymentAttempt: {
        deploymentVersionId: 'dv-candidate',
        status: 'preparing',
      },
    })
    expect(mockEmitWorkflowDeployedEvent).not.toHaveBeenCalled()
  })

  it('surfaces v2 admission failure without falling back to legacy activation', async () => {
    mockPrepareWorkflowDeployment.mockResolvedValueOnce({
      success: false,
      reason: 'invalid_request',
      error: 'nope',
    })

    const result = await performFullDeploy({
      workflowId: 'workflow-1',
      userId: 'user-1',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('nope')
    expect(mockEmitWorkflowDeployedEvent).not.toHaveBeenCalled()
  })

  it('returns a failure response when this request attempt fails terminally inline', async () => {
    const now = new Date('2026-07-14T08:00:00.000Z')
    const operation = {
      id: 'operation-conflict',
      workflowId: 'workflow-1',
      deploymentVersionId: 'dv-candidate',
      version: 5,
      previousActiveVersionId: null,
      action: 'deploy',
      protocolVersion: 2,
      generation: 2,
      status: 'preparing',
      componentReadiness: {
        webhooks: { status: 'pending', updatedAt: now.toISOString() },
        schedules: { status: 'pending', updatedAt: now.toISOString() },
        mcp: { status: 'pending', updatedAt: now.toISOString() },
      },
      errorCode: null,
      errorMessage: null,
      idempotencyKey: 'request-conflict',
      requestHash: 'hash',
      actorId: 'user-1',
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    mockPrepareWorkflowDeployment.mockImplementation(async (input) => {
      await input.onPrepareTransaction?.(mockTx, operation)
      return { success: true, operation, reused: false }
    })
    mockProcessWorkflowDeploymentOutboxEvent.mockResolvedValue('completed')
    mockGetWorkflowDeploymentStatus.mockResolvedValue({
      activeDeployment: null,
      latestOperation: {
        ...operation,
        status: 'failed',
        errorCode: 'webhook_path_conflict',
        errorMessage: 'Webhook path "/leads" is already in use. Choose a different path.',
        completedAt: now,
      },
    })

    const result = await performFullDeploy({
      workflowId: 'workflow-1',
      userId: 'user-1',
      requestId: 'request-conflict',
    })

    expect(result).toMatchObject({
      success: false,
      error: 'Webhook path "/leads" is already in use. Choose a different path.',
      errorCode: 'conflict',
    })
  })
})

describe('performActivateVersion workspace event emission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    const now = new Date('2026-07-14T08:00:00.000Z')
    const operation = {
      id: 'operation-activate-default',
      workflowId: 'workflow-1',
      deploymentVersionId: 'dv-2',
      version: 2,
      previousActiveVersionId: 'dv-1',
      action: 'activate',
      protocolVersion: 2,
      generation: 4,
      status: 'active',
      componentReadiness: {
        webhooks: { status: 'ready', updatedAt: now.toISOString() },
        schedules: { status: 'ready', updatedAt: now.toISOString() },
        mcp: { status: 'ready', updatedAt: now.toISOString() },
      },
      errorCode: null,
      errorMessage: null,
      idempotencyKey: 'request-activate-default',
      requestHash: 'hash',
      actorId: 'user-1',
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    mockProcessWorkflowDeploymentOutboxEvent.mockResolvedValue('completed')
    mockNotifySocketDeploymentChanged.mockResolvedValue(undefined)
    mockValidateWorkflowSchedules.mockReturnValue({ isValid: true })
    mockValidateTriggerWebhookConfigForDeploy.mockResolvedValue({ success: true })
    queueTableRows(schemaMock.workflowDeploymentVersion, [
      { id: 'dv-2', state: { blocks: {} }, isActive: false },
    ])
    mockEnqueueWorkflowDeploymentPreparation.mockResolvedValue('prepare-event-activate-default')
    mockPrepareWorkflowVersionActivation.mockImplementation(async (input) => {
      await input.onPrepareTransaction?.(mockTx, operation)
      return { success: true, operation, reused: false }
    })
    mockGetWorkflowDeploymentStatus.mockResolvedValue({
      activeDeployment: {
        deploymentVersionId: 'dv-2',
        version: 2,
        deployedAt: now,
      },
      latestOperation: operation,
    })
  })

  it('always admits version activation through v2 without legacy activation', async () => {
    const result = await performActivateVersion({
      workflowId: 'workflow-1',
      version: 2,
      userId: 'user-1',
    })

    expect(result.success).toBe(true)
    expect(mockPrepareWorkflowVersionActivation).toHaveBeenCalledTimes(1)
    expect(mockEnqueueWorkflowDeploymentPreparation).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ protocolVersion: 2 })
    )
    expect(mockEmitWorkflowDeployedEvent).not.toHaveBeenCalled()
  })

  it('keeps the current version active while version activation prepares', async () => {
    const now = new Date('2026-07-14T08:00:00.000Z')
    const operation = {
      id: 'operation-activate',
      workflowId: 'workflow-1',
      deploymentVersionId: 'dv-2',
      version: 2,
      previousActiveVersionId: 'dv-1',
      action: 'activate',
      protocolVersion: 2,
      generation: 4,
      status: 'preparing',
      componentReadiness: {
        webhooks: { status: 'pending', updatedAt: now.toISOString() },
        schedules: { status: 'pending', updatedAt: now.toISOString() },
        mcp: { status: 'pending', updatedAt: now.toISOString() },
      },
      errorCode: null,
      errorMessage: null,
      idempotencyKey: 'request-activate',
      requestHash: 'hash',
      actorId: 'user-1',
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    mockEnqueueWorkflowDeploymentPreparation.mockResolvedValue('prepare-event-activate')
    mockPrepareWorkflowVersionActivation.mockImplementation(async (input) => {
      await input.onPrepareTransaction?.(mockTx, operation)
      return { success: true, operation, reused: false }
    })
    mockProcessWorkflowDeploymentOutboxEvent.mockResolvedValue('pending')
    mockGetWorkflowDeploymentStatus.mockResolvedValue({
      activeDeployment: {
        deploymentVersionId: 'dv-1',
        version: 1,
        deployedAt: now,
      },
      latestOperation: operation,
    })

    const result = await performActivateVersion({
      workflowId: 'workflow-1',
      version: 2,
      userId: 'user-1',
      requestId: 'request-activate',
    })

    expect(result).toMatchObject({
      success: true,
      activeDeployment: {
        deploymentVersionId: 'dv-1',
        version: 1,
      },
      latestDeploymentAttempt: {
        id: 'operation-activate',
        deploymentVersionId: 'dv-2',
        status: 'preparing',
      },
      warnings: [expect.stringContaining('prior workflow version remains active')],
    })
    expect(mockEmitWorkflowDeployedEvent).not.toHaveBeenCalled()
  })

  it('does not emit when the version is already active (no-op activation)', async () => {
    /**
     * Per-chain overrides answer the two selects directly (version row, then
     * workflow deployedAt); the default row queued in beforeEach stays
     * unconsumed and is cleared by the next reset.
     */
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ id: 'dv-2', state: { blocks: {} }, isActive: true }])
      .mockResolvedValueOnce([{ deployedAt: new Date() }])

    const result = await performActivateVersion({
      workflowId: 'workflow-1',
      version: 2,
      userId: 'user-1',
    })

    expect(result.success).toBe(true)
    expect(mockEmitWorkflowDeployedEvent).not.toHaveBeenCalled()
  })

  it('surfaces v2 activation admission failure without legacy fallback', async () => {
    mockPrepareWorkflowVersionActivation.mockResolvedValueOnce({
      success: false,
      reason: 'invalid_request',
      error: 'nope',
    })

    const result = await performActivateVersion({
      workflowId: 'workflow-1',
      version: 2,
      userId: 'user-1',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('nope')
    expect(mockEmitWorkflowDeployedEvent).not.toHaveBeenCalled()
  })
})
