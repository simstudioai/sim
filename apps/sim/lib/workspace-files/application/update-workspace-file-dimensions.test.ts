/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(),
  updateDimensions: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  loadActiveWorkspaceFileContext: mocks.loadContext,
  updateWorkspaceFileDimensions: mocks.updateDimensions,
}))

import { updateWorkspaceFileDimensionsOperation } from '@/lib/workspace-files/application/update-workspace-file-dimensions'

describe('updateWorkspaceFileDimensionsOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue({
      fileId: 'file-1',
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner',
    })
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.updateDimensions.mockResolvedValue(false)
  })

  it('preserves a stale-key write as a successful false result', async () => {
    const result = await updateWorkspaceFileDimensionsOperation.execute({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      input: {
        fileId: 'file-1',
        assertedWorkspaceId: 'workspace-1',
        key: 'workspace/workspace-1/current-key',
        width: 800,
        height: 600,
      },
    })

    expect(result).toEqual({ success: false })
    expect(mocks.loadContext).toHaveBeenCalledWith('file-1', { includeDeleted: undefined })
    expect(mocks.updateDimensions).toHaveBeenCalledWith('workspace-1', 'file-1', {
      key: 'workspace/workspace-1/current-key',
      width: 800,
      height: 600,
    })
  })
})
