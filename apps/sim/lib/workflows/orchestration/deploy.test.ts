/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
  workflowAuthzMockFns,
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
  mockUpdateDeploymentVersionMetadata,
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
  mockUpdateDeploymentVersionMetadata: vi.fn(),
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

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowDeploymentSnapshot: mockLoadWorkflowDeploymentSnapshot,
  saveWorkflowToNormalizedTables: mockSaveWorkflowToNormalizedTables,
  undeployWorkflow: vi.fn(),
  updateDeploymentVersionMetadata: mockUpdateDeploymentVersionMetadata,
}))

vi.mock('@/lib/webhooks/deploy', () => ({
  validateTriggerWebhookConfigForDeploy: mockValidateTriggerWebhookConfigForDeploy,
}))

vi.mock('@/lib/workflows/schedules', () => ({
  validateWorkflowSchedules: mockValidateWorkflowSchedules,
}))

// Resolves to the global @sim/platform-authz/workflow mock, so instanceof matches.
import { WorkflowLockedError } from '@sim/platform-authz/workflow'
import {
  getWorkflowDeploymentSummary,
  performActivateVersion,
  performFullDeploy,
  performFullUndeploy,
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
    mockUpdateDeploymentVersionMetadata.mockResolvedValue({ name: null, description: null })
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

  it('marks the latest active operation historical when no matching version is live', async () => {
    const now = new Date('2026-07-14T08:00:00.000Z')
    mockGetWorkflowDeploymentStatus.mockResolvedValueOnce({
      activeDeployment: null,
      latestOperation: {
        id: 'operation-historical',
        workflowId: 'workflow-1',
        deploymentVersionId: 'dv-old',
        version: 3,
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
        idempotencyKey: 'request-historical',
        requestHash: 'hash',
        actorId: 'user-1',
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    })

    const result = await getWorkflowDeploymentSummary('workflow-1')

    expect(result).toMatchObject({
      activeDeployment: null,
      latestDeploymentAttempt: {
        id: 'operation-historical',
        status: 'active',
        isCurrent: false,
        error: null,
      },
      warnings: [expect.stringContaining('historical')],
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

  it('does not reuse a correlation request ID as an implicit idempotency key', async () => {
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'My Workflow', workspaceId: 'workspace-1' },
      { id: 'workflow-1', name: 'My Workflow', workspaceId: 'workspace-1' },
    ])

    const params = { workflowId: 'workflow-1', userId: 'user-1', requestId: 'request-1' }
    await performFullDeploy(params)
    await performFullDeploy(params)

    const firstKey = mockPrepareWorkflowDeployment.mock.calls[0][0].idempotencyKey
    const secondKey = mockPrepareWorkflowDeployment.mock.calls[1][0].idempotencyKey
    expect(firstKey).toEqual(expect.any(String))
    expect(secondKey).toEqual(expect.any(String))
    expect(firstKey).not.toBe('request-1')
    expect(firstKey).not.toBe(secondKey)
  })

  it('keeps retry identity stable across snapshot timestamps, edge order, and label wording', async () => {
    queueTableRows(schemaMock.workflow, [
      { id: 'workflow-1', name: 'My Workflow', workspaceId: 'workspace-1' },
      { id: 'workflow-1', name: 'My Workflow', workspaceId: 'workspace-1' },
    ])
    const baseState = {
      blocks: {},
      edges: [
        { id: 'edge-b', source: 'block-2', target: 'block-3' },
        { id: 'edge-a', source: 'block-1', target: 'block-2' },
      ],
      loops: {},
      parallels: {},
      variables: {},
      lastSaved: 1,
    }
    mockLoadWorkflowDeploymentSnapshot.mockResolvedValueOnce(baseState).mockResolvedValueOnce({
      ...baseState,
      edges: [...baseState.edges].reverse(),
      lastSaved: 2,
    })

    const params = {
      workflowId: 'workflow-1',
      userId: 'user-1',
      idempotencyKey: 'copilot:execution-1:tool-call:call-1',
    }
    await performFullDeploy({
      ...params,
      versionName: 'First wording',
      versionDescription: 'First description',
    })
    await performFullDeploy({
      ...params,
      versionName: 'Retry wording',
      versionDescription: 'Rephrased description',
    })

    expect(mockPrepareWorkflowDeployment.mock.calls[0][0].requestHash).toBe(
      mockPrepareWorkflowDeployment.mock.calls[1][0].requestHash
    )
    const firstRequest = mockPrepareWorkflowDeployment.mock.calls[0][0]
    expect(firstRequest.idempotencyKey).toBe(
      `copilot:execution-1:tool-call:call-1:request:${firstRequest.requestHash}`
    )
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

  it('commits optional metadata inside activation admission before enqueueing work', async () => {
    mockUpdateDeploymentVersionMetadata.mockResolvedValue({
      name: 'Release 2',
      description: 'Ready for production',
    })

    const result = await performActivateVersion({
      workflowId: 'workflow-1',
      version: 2,
      userId: 'user-1',
      name: 'Release 2',
      description: 'Ready for production',
    })

    expect(result).toMatchObject({
      success: true,
      name: 'Release 2',
      description: 'Ready for production',
    })
    expect(mockUpdateDeploymentVersionMetadata).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      version: 2,
      name: 'Release 2',
      description: 'Ready for production',
      tx: mockTx,
    })
    expect(mockUpdateDeploymentVersionMetadata).toHaveBeenCalledBefore(
      mockEnqueueWorkflowDeploymentPreparation
    )
  })

  it('does not enqueue activation when transactional metadata persistence fails', async () => {
    mockUpdateDeploymentVersionMetadata.mockRejectedValueOnce(new Error('metadata write failed'))

    const result = await performActivateVersion({
      workflowId: 'workflow-1',
      version: 2,
      userId: 'user-1',
      name: 'Release 2',
    })

    expect(result).toMatchObject({ success: false, errorCode: 'internal' })
    expect(mockEnqueueWorkflowDeploymentPreparation).not.toHaveBeenCalled()
  })

  it('reports post-admission activation failure while preserving admitted metadata', async () => {
    const failedAt = new Date('2026-07-14T08:01:00.000Z')
    mockUpdateDeploymentVersionMetadata.mockResolvedValue({
      name: 'Release 2',
      description: null,
    })
    mockGetWorkflowDeploymentStatus.mockResolvedValue({
      activeDeployment: null,
      latestOperation: {
        id: 'operation-activate-default',
        workflowId: 'workflow-1',
        deploymentVersionId: 'dv-2',
        version: 2,
        previousActiveVersionId: 'dv-1',
        action: 'activate',
        protocolVersion: 2,
        generation: 4,
        status: 'failed',
        componentReadiness: {},
        errorCode: 'webhook_path_conflict',
        errorMessage: 'Webhook path is already in use',
        idempotencyKey: 'request-activate-default',
        requestHash: 'hash',
        actorId: 'user-1',
        completedAt: failedAt,
        createdAt: failedAt,
        updatedAt: failedAt,
      },
    })

    const result = await performActivateVersion({
      workflowId: 'workflow-1',
      version: 2,
      userId: 'user-1',
      name: 'Release 2',
    })

    expect(result).toMatchObject({
      success: false,
      error: 'Webhook path is already in use',
      errorCode: 'conflict',
      name: 'Release 2',
    })
    expect(mockUpdateDeploymentVersionMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Release 2', tx: mockTx })
    )
    expect(mockEnqueueWorkflowDeploymentPreparation).toHaveBeenCalledOnce()
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

describe('mutation lock on the orchestration entry points', () => {
  const mockAssertMutable = workflowAuthzMockFns.mockAssertWorkflowMutable

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockAssertMutable.mockRejectedValue(new WorkflowLockedError('Workflow is locked'))
  })

  it.each([
    ['performFullDeploy', () => performFullDeploy({ workflowId: 'wf-1', userId: 'user-1' })],
    ['performFullUndeploy', () => performFullUndeploy({ workflowId: 'wf-1', userId: 'user-1' })],
    [
      'performActivateVersion',
      () => performActivateVersion({ workflowId: 'wf-1', version: 2, userId: 'user-1' }),
    ],
  ])('%s returns a lock denial instead of throwing', async (_name, call) => {
    // Callers like performChatDeploy and the copilot deploy tools consume the
    // result object; a throw surfaces as a generic 500 instead of a denial.
    const result = await call()

    expect(result.success).toBe(false)
    expect(result.error).toContain('locked')
    expect(result.errorCode).toBe('locked')
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('proceeds past the gate when the workflow is mutable', async () => {
    mockAssertMutable.mockResolvedValue(undefined)

    await performFullUndeploy({ workflowId: 'wf-1', userId: 'user-1' })

    expect(mockAssertMutable).toHaveBeenCalledWith('wf-1')
  })
})
