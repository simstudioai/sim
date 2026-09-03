/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getFile: vi.fn(),
  loadContext: vi.fn(),
  resolvePermission: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: mocks.getFile,
  loadActiveWorkspaceFileContext: mocks.loadContext,
}))

import {
  downloadWorkspaceFileRecord,
  readWorkspaceFileContentRecord,
} from '@/lib/workspace-files/application/read-workspace-file-record'

const context = {
  fileId: 'file-1',
  workspaceId: 'workspace-1',
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}

const file = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'report.pdf',
}

describe('workspace file record reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.getFile.mockResolvedValue(file)
  })

  it.each([
    [readWorkspaceFileContentRecord, 'files.read_content'],
    [downloadWorkspaceFileRecord, 'files.download'],
  ] as const)(
    'uses the %s operation for its canonical record read',
    async (useCase, operationId) => {
      await expect(
        useCase.execute({
          principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
          input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
        })
      ).resolves.toEqual({ file })

      expect(useCase.operation.id).toBe(operationId)
      expect(mocks.loadContext).toHaveBeenCalledWith('file-1', {
        includeDeleted: undefined,
        includeChatUploads: true,
      })
      expect(mocks.getFile).toHaveBeenCalledWith('workspace-1', 'file-1', {
        throwOnError: true,
        includeChatUploads: true,
      })
    }
  )
})
