/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock, workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  recordAudit: vi.fn(),
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { WORKFLOW_VARIABLES_UPDATED: 'workflow.variables_updated' },
  AuditResourceType: { WORKFLOW: 'workflow' },
  recordAudit: mocks.recordAudit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveContext,
}))

vi.mock('@/lib/realtime/notify', () => ({ notifyWorkflowUpdated: mocks.notify }))

import { updateWorkflowVariables } from '@/lib/workflows/application/update-workflow-content'

const context = {
  workflowId: 'workflow-1',
  workflow: { id: 'workflow-1', name: 'Workflow', workspaceId: 'workspace-1' },
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

describe('updateWorkflowVariables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolveContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('write')
    workflowAuthzMockFns.mockAssertWorkflowMutable.mockResolvedValue(undefined)
    dbChainMockFns.returning.mockResolvedValue([{ id: 'workflow-1' }])
  })

  it('projects semantic audit and realtime effects after the durable write', async () => {
    await expect(
      updateWorkflowVariables.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: {
          workflowId: 'workflow-1',
          variables: { variable: { id: 'variable', name: 'threshold', value: 5 } },
          operationCount: 1,
          source: 'copilot',
        },
      })
    ).resolves.toEqual({ updated: 1 })

    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow.variables_updated',
        resourceId: 'workflow-1',
        metadata: expect.objectContaining({
          operation: 'workflows.variables.update',
          operationCount: 1,
          source: 'copilot',
        }),
      })
    )
    expect(mocks.notify).toHaveBeenCalledWith('workflow-1')
    expect(dbChainMockFns.returning).toHaveBeenCalledBefore(mocks.notify)
  })
})
