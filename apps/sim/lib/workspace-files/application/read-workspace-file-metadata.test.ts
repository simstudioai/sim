import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { publicSharesMock, publicSharesMockFns } from '@sim/testing/mocks/public-shares.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)
vi.mock('@/lib/public-shares/share-manager', () => publicSharesMock)

import { NoWorkspaceAccessError } from '@/lib/core/application'
import { readWorkspaceFileMetadata } from '@/lib/workspace-files/application/read-workspace-file-metadata'

const mocks = {
  ...hoisted,
  getShareForResource: publicSharesMockFns.mockGetShareForResource,
  loadContext: workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext,
  getWorkspaceFile: workspaceFileManagerMockFns.mockGetWorkspaceFile,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

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
    mocks.loadContext.mockResolvedValue(canonical)
    mocks.getWorkspaceFile.mockResolvedValue(file)
    mocks.getShareForResource.mockResolvedValue(share)
    mocks.resolvePermission.mockResolvedValue('admin')
  })

  it('authorizes an archived read exactly like an active one', async () => {
    mocks.resolvePermission.mockResolvedValueOnce(null)

    await expect(
      readWorkspaceFileMetadata.execute({
        principal: createSessionPrincipal({ userId: 'outsider', sessionId: 'session-2' }),
        input: {
          fileId: 'file-1',
          assertedWorkspaceId: 'workspace-1',
          includeDeleted: true,
        },
      })
    ).rejects.toBeInstanceOf(NoWorkspaceAccessError)

    expect(mocks.getWorkspaceFile).not.toHaveBeenCalled()
    expect(mocks.getShareForResource).not.toHaveBeenCalled()
  })

  it('still refuses an archived read that asserts the wrong workspace', async () => {
    await expect(
      readWorkspaceFileMetadata.execute({
        principal: createSessionPrincipal(),
        input: {
          fileId: 'file-1',
          assertedWorkspaceId: 'workspace-2',
          includeDeleted: true,
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.getWorkspaceFile).not.toHaveBeenCalled()
  })
})
