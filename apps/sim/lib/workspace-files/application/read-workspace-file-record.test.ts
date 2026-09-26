import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)

import {
  downloadWorkspaceFileRecord,
  readWorkspaceFileContentRecord,
} from '@/lib/workspace-files/application/read-workspace-file-record'

const mocks = {
  getFile: workspaceFileManagerMockFns.mockGetWorkspaceFile,
  loadContext: workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
}

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
          principal: createSessionPrincipal(),
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
  it('rejects a foreign asserted workspace before reading file metadata', async () => {
    await expect(
      readWorkspaceFileContentRecord.execute({
        principal: createSessionPrincipal(),
        input: { fileId: 'file-1', assertedWorkspaceId: 'other-workspace' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.getFile).not.toHaveBeenCalled()
  })

  it('requires current workspace access before reading an addressed upload', async () => {
    mocks.resolvePermission.mockResolvedValue(null)
    await expect(
      readWorkspaceFileContentRecord.execute({
        principal: createSessionPrincipal({ userId: 'outsider', sessionId: 'session-2' }),
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-1' },
      })
    ).rejects.toThrow()
    expect(mocks.getFile).not.toHaveBeenCalled()
  })
})
