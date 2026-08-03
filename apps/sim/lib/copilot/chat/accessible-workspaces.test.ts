/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListAccessibleWorkspaceRowsForUser } = vi.hoisted(() => ({
  mockListAccessibleWorkspaceRowsForUser: vi.fn(),
}))

vi.mock('@/lib/workspaces/utils', () => ({
  listAccessibleWorkspaceRowsForUser: mockListAccessibleWorkspaceRowsForUser,
}))

import { getAccessibleWorkspacesForCopilot } from '@/lib/copilot/chat/accessible-workspaces'

describe('getAccessibleWorkspacesForCopilot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns active workspace identity and effective permission in stable order', async () => {
    mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([
      { workspace: { id: 'ws-2', name: 'Production' }, permissionType: 'admin' },
      { workspace: { id: 'ws-1', name: 'Marketing' }, permissionType: 'write' },
    ])

    await expect(getAccessibleWorkspacesForCopilot('user-1')).resolves.toEqual([
      { id: 'ws-1', name: 'Marketing', permission: 'write' },
      { id: 'ws-2', name: 'Production', permission: 'admin' },
    ])
    expect(mockListAccessibleWorkspaceRowsForUser).toHaveBeenCalledWith('user-1')
  })

  it('degrades to no context when the informational lookup fails', async () => {
    mockListAccessibleWorkspaceRowsForUser.mockRejectedValue(new Error('database unavailable'))

    await expect(getAccessibleWorkspacesForCopilot('user-1')).resolves.toEqual([])
  })
})
