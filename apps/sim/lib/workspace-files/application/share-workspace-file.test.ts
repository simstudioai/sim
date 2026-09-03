/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorkspaceShares: vi.fn(),
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  getShareForResource: vi.fn(),
  getWorkspaceSharesForResources: mocks.getWorkspaceShares,
  ShareValidationError: class ShareValidationError extends Error {},
  upsertFileShare: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: vi.fn(),
  loadActiveWorkspaceContext: mocks.loadWorkspace,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validatePublicFileSharing: vi.fn(),
}))

import { getWorkspaceFileShares } from '@/lib/workspace-files/application/share-workspace-file'
import { MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS } from '@/lib/workspace-files/limits'

const principal = {
  kind: 'session' as const,
  userId: 'user-1',
  sessionId: 'session-1',
}

describe('getWorkspaceFileShares', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: 'workspace-1',
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner',
    })
    mocks.getWorkspaceShares.mockResolvedValue(new Map())
  })

  it('deduplicates ids and constrains the batch lookup to the authorized workspace', async () => {
    await getWorkspaceFileShares.execute({
      principal,
      input: { workspaceId: 'workspace-1', fileIds: ['file-1', 'file-1', 'file-2'] },
    })

    expect(mocks.getWorkspaceShares).toHaveBeenCalledWith('file', 'workspace-1', [
      'file-1',
      'file-2',
    ])
  })

  it('refuses an oversized batch before querying shares', async () => {
    const fileIds = Array.from(
      { length: MAX_WORKSPACE_FILE_BULK_AFFECTED_ITEMS + 1 },
      (_, index) => `file-${index}`
    )

    await expect(
      getWorkspaceFileShares.execute({
        principal,
        input: { workspaceId: 'workspace-1', fileIds },
      })
    ).rejects.toMatchObject({ code: 'payload_too_large' })

    expect(mocks.getWorkspaceShares).not.toHaveBeenCalled()
  })
})
