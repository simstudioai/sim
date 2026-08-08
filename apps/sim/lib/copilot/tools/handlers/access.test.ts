/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authorizeWorkflow, checkWorkspaceAccess } = vi.hoisted(() => ({
  authorizeWorkflow: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
}))

vi.mock('@sim/platform-authz/workflow', () => ({
  authorizeWorkflowByWorkspacePermission: authorizeWorkflow,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess,
}))

vi.mock('@/lib/workspaces/utils', () => ({
  listAccessibleWorkspaceRowsForUser: vi.fn(),
}))

import { ensureWorkflowAccess, ensureWorkspaceAccess } from './access'

describe('Copilot access scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows a workflow in the trusted workspace', async () => {
    const workflow = { id: 'wf-1', workspaceId: 'ws-1' }
    authorizeWorkflow.mockResolvedValue({ allowed: true, workflow })

    await expect(
      ensureWorkflowAccess('wf-1', { userId: 'user-1', workspaceId: 'ws-1' })
    ).resolves.toEqual({ workflow, workspaceId: 'ws-1' })
  })

  it('hides a workflow outside the trusted workspace', async () => {
    authorizeWorkflow.mockResolvedValue({
      allowed: true,
      workflow: { id: 'wf-2', workspaceId: 'ws-2' },
    })

    await expect(
      ensureWorkflowAccess('wf-2', { userId: 'user-1', workspaceId: 'ws-1' })
    ).rejects.toThrow('Workflow wf-2 not found')
  })

  it('rejects a workspace outside the trusted scope before its membership lookup', async () => {
    await expect(
      ensureWorkspaceAccess('ws-2', { userId: 'user-1', workspaceId: 'ws-1' })
    ).rejects.toThrow('Workspace ws-2 not found')
    expect(checkWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('preserves normal permission checks inside the trusted workspace', async () => {
    const access = {
      exists: true,
      hasAccess: true,
      canWrite: true,
      canAdmin: false,
    }
    checkWorkspaceAccess.mockResolvedValue(access)

    await expect(
      ensureWorkspaceAccess('ws-1', { userId: 'user-1', workspaceId: 'ws-1' }, 'write')
    ).resolves.toBe(access)
    expect(checkWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'user-1')
  })
})
