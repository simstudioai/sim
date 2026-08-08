/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ loadWorkspace: vi.fn() }))

vi.mock('@/lib/core/async-jobs', () => ({ getJobQueue: vi.fn() }))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

import {
  resolveActiveWorkflowApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workflows/application/context'

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOrganizationId: 'organization-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-user-1',
}
const workflow = { id: 'workflow-1', workspaceId: 'workspace-1', archivedAt: null }

describe('workflow application contexts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.loadWorkspace.mockResolvedValue(workspace)
  })

  it('uses the canonical loader for workspace-scoped operations', async () => {
    await expect(resolveActiveWorkspaceApplicationContext('workspace-1')).resolves.toBe(workspace)
    expect(mocks.loadWorkspace).toHaveBeenCalledWith('workspace-1')
  })

  it('derives workflow authorization from its canonical active workspace', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workflowId: 'workflow-1', workflow, workspaceId: 'workspace-1' },
    ])

    await expect(
      resolveActiveWorkflowApplicationContext({
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-1',
      })
    ).resolves.toEqual({ ...workspace, workflowId: 'workflow-1', workflow })
    expect(mocks.loadWorkspace).toHaveBeenCalledWith('workspace-1')
  })

  it('conceals an asserted workspace mismatch before loading workspace policy', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workflowId: 'workflow-1', workflow, workspaceId: 'workspace-1' },
    ])

    await expect(
      resolveActiveWorkflowApplicationContext({
        workflowId: 'workflow-1',
        assertedWorkspaceId: 'workspace-2',
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Workflow not found' })
    expect(mocks.loadWorkspace).not.toHaveBeenCalled()
  })

  it('conceals an inactive canonical workspace as workflow absence', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workflowId: 'workflow-1', workflow, workspaceId: 'workspace-1' },
    ])
    mocks.loadWorkspace.mockResolvedValueOnce(null)

    await expect(
      resolveActiveWorkflowApplicationContext({ workflowId: 'workflow-1' })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Workflow not found' })
  })

  it('propagates canonical workspace database failures', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { workflowId: 'workflow-1', workflow, workspaceId: 'workspace-1' },
    ])
    const failure = new Error('workspace database unavailable')
    mocks.loadWorkspace.mockRejectedValueOnce(failure)

    await expect(
      resolveActiveWorkflowApplicationContext({ workflowId: 'workflow-1' })
    ).rejects.toBe(failure)
  })
})
