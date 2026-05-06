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
} = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockSaveWorkflowToNormalizedTables: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockCaptureServerEvent: vi.fn(),
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
  AuditAction: { WORKFLOW_DEPLOYMENT_REVERTED: 'WORKFLOW_DEPLOYMENT_REVERTED' },
  AuditResourceType: { WORKFLOW: 'WORKFLOW' },
  recordAudit: mockRecordAudit,
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
  activateWorkflowVersion: vi.fn(),
  activateWorkflowVersionById: vi.fn(),
  deployWorkflow: vi.fn(),
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
}))

vi.mock('@/lib/workflows/schedules', () => ({
  cleanupDeploymentVersion: vi.fn(),
  createSchedulesForDeploy: vi.fn(),
  validateWorkflowSchedules: vi.fn(),
}))

import { performRevertToVersion } from '@/lib/workflows/orchestration/deploy'

describe('performRevertToVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
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
      })
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
