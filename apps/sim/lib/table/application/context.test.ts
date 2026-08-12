/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getTableById, loadWorkspace } = vi.hoisted(() => ({
  getTableById: vi.fn(),
  loadWorkspace: vi.fn(),
}))

vi.mock('@/lib/table', () => ({ getTableById }))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: loadWorkspace,
}))

import { resolveActiveTableContext } from '@/lib/table/application/context'

describe('table application context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getTableById.mockResolvedValue({
      id: 'table-1',
      workspaceId: 'workspace-1',
      name: 'Contacts',
    })
    loadWorkspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: 'organization-1',
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-user-1',
    })
  })

  it('derives workspace scope from the canonical active table', async () => {
    await expect(
      resolveActiveTableContext({ tableId: 'table-1', assertedWorkspaceId: 'workspace-1' })
    ).resolves.toMatchObject({
      tableId: 'table-1',
      workspaceId: 'workspace-1',
      billedAccountUserId: 'billing-user-1',
    })
    expect(getTableById).toHaveBeenCalledWith('table-1')
    expect(loadWorkspace).toHaveBeenCalledWith('workspace-1')
  })

  it('conceals an asserted cross-workspace table before workspace resolution', async () => {
    await expect(
      resolveActiveTableContext({ tableId: 'table-1', assertedWorkspaceId: 'workspace-2' })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Table not found' })
    expect(loadWorkspace).not.toHaveBeenCalled()
  })

  it('fails when the canonical workspace is unavailable', async () => {
    loadWorkspace.mockResolvedValueOnce(null)

    await expect(resolveActiveTableContext({ tableId: 'table-1' })).rejects.toMatchObject({
      code: 'not_found',
      message: 'Workspace not found',
    })
  })

  it('propagates canonical workspace database failures', async () => {
    const failure = new Error('workspace database unavailable')
    loadWorkspace.mockRejectedValueOnce(failure)

    await expect(resolveActiveTableContext({ tableId: 'table-1' })).rejects.toBe(failure)
  })
})
