/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockLimit,
  mockUpdateSet,
  mockSaveWorkflowToNormalizedTables,
  mockRecordAudit,
  mockCaptureServerEvent,
  mockTransaction,
  mockDeployWorkflow,
  mockActivateWorkflowVersion,
  mockValidateWorkflowSchedules,
  mockValidateTriggerWebhookConfigForDeploy,
  mockEmitWorkflowDeployedEvent,
  mockTx,
} = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockSaveWorkflowToNormalizedTables: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
  mockTransaction: vi.fn(),
  mockDeployWorkflow: vi.fn(),
  mockActivateWorkflowVersion: vi.fn(),
  mockValidateWorkflowSchedules: vi.fn(),
  mockValidateTriggerWebhookConfigForDeploy: vi.fn(),
  mockEmitWorkflowDeployedEvent: vi.fn(),
  mockTx: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => ({
            for: vi.fn().mockResolvedValue([{ id: 'workflow-1' }]),
          })),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    })),
    execute: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockLimit,
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: mockUpdateSet,
    })),
    transaction: mockTransaction,
  },
  workflow: { id: 'workflow.id' },
  workflowDeploymentVersion: {
    workflowId: 'workflowDeploymentVersion.workflowId',
    version: 'workflowDeploymentVersion.version',
    isActive: 'workflowDeploymentVersion.isActive',
    state: 'workflowDeploymentVersion.state',
  },
}))

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
  enqueueWorkflowDeploymentSideEffects: vi.fn().mockResolvedValue('outbox-1'),
  enqueueWorkflowUndeploySideEffects: vi.fn().mockResolvedValue('outbox-2'),
  processWorkflowDeploymentOutboxEvent: vi.fn().mockResolvedValue('completed'),
}))

vi.mock('@/lib/workspace-events/emitter', () => ({
  emitWorkflowDeployedEvent: mockEmitWorkflowDeployedEvent,
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
  activateWorkflowVersion: mockActivateWorkflowVersion,
  activateWorkflowVersionById: vi.fn(),
  deployWorkflow: mockDeployWorkflow,
  loadWorkflowDeploymentSnapshot: vi.fn(),
  saveWorkflowToNormalizedTables: mockSaveWorkflowToNormalizedTables,
  undeployWorkflow: vi.fn(),
}))

vi.mock('@/lib/mcp/workflow-mcp-sync', () => ({
  removeMcpToolsForWorkflow: vi.fn(),
  syncMcpToolsForWorkflow: vi.fn(),
}))

vi.mock('@/lib/webhooks/deploy', () => ({
  cleanupWebhooksForWorkflow: vi.fn(),
  restorePreviousVersionWebhooks: vi.fn(),
  saveTriggerWebhooksForDeploy: vi.fn(),
  validateTriggerWebhookConfigForDeploy: mockValidateTriggerWebhookConfigForDeploy,
}))

vi.mock('@/lib/workflows/schedules', () => ({
  cleanupDeploymentVersion: vi.fn(),
  createSchedulesForDeploy: vi.fn(),
  validateWorkflowSchedules: mockValidateWorkflowSchedules,
}))

import {
  performActivateVersion,
  performFullDeploy,
  performRevertToVersion,
} from '@/lib/workflows/orchestration/deploy'

describe('performRevertToVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    mockTransaction.mockImplementation(async (callback) => callback(mockTx))
    mockTx.select.mockImplementation((selection?: Record<string, unknown>) => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit:
            selection && Object.hasOwn(selection, 'state')
              ? mockLimit
              : vi.fn(() => ({
                  for: vi.fn().mockResolvedValue([{ id: 'workflow-1' }]),
                })),
        })),
      })),
    }))
    mockTx.update.mockReturnValue({ set: mockUpdateSet })
    mockUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    mockSaveWorkflowToNormalizedTables.mockResolvedValue({ success: true })
  })

  it('restores variables when the deployment snapshot includes them', async () => {
    mockLimit.mockResolvedValue([
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
      mockTx
    )
    expect(mockUpdateSet).toHaveBeenCalledWith(
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
    mockLimit.mockResolvedValue([
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
    const workflowUpdate = mockUpdateSet.mock.calls[0][0]
    expect(Object.hasOwn(workflowUpdate, 'variables')).toBe(false)
  })
})

describe('performFullDeploy workspace event emission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    mockLimit.mockResolvedValue([
      { id: 'workflow-1', name: 'My Workflow', workspaceId: 'workspace-1' },
    ])
    mockDeployWorkflow.mockResolvedValue({
      success: true,
      deployedAt: new Date(),
      version: 4,
      deploymentVersionId: 'dv-1',
      previousVersionId: null,
      currentState: { blocks: {} },
    })
  })

  it('emits workflow_deployed after a successful deploy', async () => {
    const result = await performFullDeploy({
      workflowId: 'workflow-1',
      userId: 'user-1',
    })

    expect(result.success).toBe(true)
    expect(mockEmitWorkflowDeployedEvent).toHaveBeenCalledTimes(1)
    expect(mockEmitWorkflowDeployedEvent).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      workflowName: 'My Workflow',
      workspaceId: 'workspace-1',
      version: 4,
    })
  })

  it('does not emit when the deploy fails', async () => {
    mockDeployWorkflow.mockResolvedValueOnce({ success: false, error: 'nope' })

    const result = await performFullDeploy({
      workflowId: 'workflow-1',
      userId: 'user-1',
    })

    expect(result.success).toBe(false)
    expect(mockEmitWorkflowDeployedEvent).not.toHaveBeenCalled()
  })

  it('emission rejection does not fail the deploy', async () => {
    mockEmitWorkflowDeployedEvent.mockRejectedValueOnce(new Error('emit failed'))

    const result = await performFullDeploy({
      workflowId: 'workflow-1',
      userId: 'user-1',
    })

    expect(result.success).toBe(true)
  })
})

describe('performActivateVersion workspace event emission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
    mockValidateWorkflowSchedules.mockReturnValue({ isValid: true })
    mockValidateTriggerWebhookConfigForDeploy.mockResolvedValue({ success: true })
    mockLimit.mockResolvedValue([{ id: 'dv-2', state: { blocks: {} }, isActive: false }])
    mockActivateWorkflowVersion.mockResolvedValue({
      success: true,
      deployedAt: new Date(),
      previousVersionId: 'dv-1',
    })
  })

  it('emits workflow_deployed when activating a version (rollback/activation)', async () => {
    const result = await performActivateVersion({
      workflowId: 'workflow-1',
      version: 2,
      userId: 'user-1',
      workflow: { id: 'workflow-1', name: 'My Workflow', workspaceId: 'workspace-1' },
    })

    expect(result.success).toBe(true)
    expect(mockEmitWorkflowDeployedEvent).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      workflowName: 'My Workflow',
      workspaceId: 'workspace-1',
      version: 2,
    })
  })

  it('does not emit when the version is already active (no-op activation)', async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: 'dv-2', state: { blocks: {} }, isActive: true }])
      .mockResolvedValueOnce([{ deployedAt: new Date() }])

    const result = await performActivateVersion({
      workflowId: 'workflow-1',
      version: 2,
      userId: 'user-1',
      workflow: { id: 'workflow-1', name: 'My Workflow', workspaceId: 'workspace-1' },
    })

    expect(result.success).toBe(true)
    expect(mockEmitWorkflowDeployedEvent).not.toHaveBeenCalled()
  })

  it('does not emit when activation fails', async () => {
    mockActivateWorkflowVersion.mockResolvedValueOnce({ success: false, error: 'nope' })

    const result = await performActivateVersion({
      workflowId: 'workflow-1',
      version: 2,
      userId: 'user-1',
      workflow: { id: 'workflow-1', name: 'My Workflow', workspaceId: 'workspace-1' },
    })

    expect(result.success).toBe(false)
    expect(mockEmitWorkflowDeployedEvent).not.toHaveBeenCalled()
  })
})
