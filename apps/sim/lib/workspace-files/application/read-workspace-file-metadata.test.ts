/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadAuthorized: vi.fn(),
  getWorkspaceFile: vi.fn(),
}))

vi.mock('@/lib/workspace-files/application/load-authorized-workspace-file', () => ({
  loadAuthorizedWorkspaceFile: mocks.loadAuthorized,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: mocks.getWorkspaceFile,
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

describe('readWorkspaceFileMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadAuthorized.mockResolvedValue(canonical)
    mocks.getWorkspaceFile.mockResolvedValue(file)
  })

  it('returns the canonical active file without side effects', async () => {
    const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }

    await expect(
      readWorkspaceFileMetadata.execute({
        principal,
        input: {
          fileId: 'file-1',
          assertedWorkspaceId: 'workspace-1',
        },
      })
    ).resolves.toEqual({ file })

    expect(mocks.loadAuthorized).toHaveBeenCalledWith({
      principal,
      operation: readWorkspaceFileMetadata.operation,
      fileId: 'file-1',
      assertedWorkspaceId: 'workspace-1',
    })
    expect(mocks.getWorkspaceFile).toHaveBeenCalledWith('workspace-1', 'file-1', {
      throwOnError: true,
    })
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
