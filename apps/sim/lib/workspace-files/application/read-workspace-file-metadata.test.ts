/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(),
  getWorkspaceFile: vi.fn(),
  getShareForResource: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: mocks.getWorkspaceFile,
  loadActiveWorkspaceFileContext: mocks.loadContext,
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  getShareForResource: mocks.getShareForResource,
}))

import { readWorkspaceFileMetadata } from '@/lib/workspace-files/application/read-workspace-file-metadata'

const canonical = {
  fileId: 'file-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'data.csv',
  key: 'workspace/ws/data.csv',
  path: '/api/files/serve/data.csv',
  size: 42,
  type: 'text/csv',
  uploadedBy: 'user-1',
  folderId: null,
  uploadedAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
}

const share = {
  id: 'share-1',
  token: 'share-token',
  url: 'https://example.com/f/share-token',
  isActive: true,
  resourceType: 'file' as const,
  resourceId: 'file-1',
  authType: 'public' as const,
  hasPassword: false,
  allowedEmails: [],
}

describe('readWorkspaceFileMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(canonical)
    mocks.getWorkspaceFile.mockResolvedValue(file)
    mocks.getShareForResource.mockResolvedValue(share)
    mocks.resolvePermission.mockResolvedValue('admin')
  })

  it('returns the canonical active file and its share status without side effects', async () => {
    const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }

    await expect(
      readWorkspaceFileMetadata.execute({
        principal,
        input: {
          fileId: 'file-1',
          assertedWorkspaceId: 'workspace-1',
        },
      })
    ).resolves.toEqual({ file, share })

    expect(mocks.loadContext).toHaveBeenCalledWith('file-1', {
      includeDeleted: undefined,
    })
    expect(mocks.getWorkspaceFile).toHaveBeenCalledWith('workspace-1', 'file-1', {
      throwOnError: true,
    })
    expect(mocks.getShareForResource).toHaveBeenCalledWith('file', 'file-1')
  })

  it('fails fast if the authorized file disappears before projection', async () => {
    mocks.getWorkspaceFile.mockResolvedValueOnce(null)

    await expect(
      readWorkspaceFileMetadata.execute({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { fileId: 'file-1' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})
