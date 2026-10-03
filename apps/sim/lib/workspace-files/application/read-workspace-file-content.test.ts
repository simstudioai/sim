import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from '@sim/testing/mocks/workspace-file-manager.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import {
  workspaceUploadsMock,
  workspaceUploadsMockFns,
} from '@sim/testing/mocks/workspace-uploads.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)

vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => workspaceFileManagerMock)

vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)

import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'

const mocks = {
  getSecretProvenance:
    workspaceFileSecretProvenanceMockFns.mockGetBoundWorkspaceFileSecretProvenance,
  loadContext: workspaceFileManagerMockFns.mockLoadActiveWorkspaceFileContext,
  fetchBuffer: workspaceUploadsMockFns.mockFetchWorkspaceFileBuffer,
  getFile: workspaceUploadsMockFns.mockGetWorkspaceFile,
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
  name: 'source.txt',
  key: 'workspace/workspace-1/source.txt',
  size: 12,
}

describe('readWorkspaceFileContent', () => {
  beforeEach(() => {
    mocks.loadContext.mockResolvedValue(context)
    mocks.resolvePermission.mockResolvedValue('admin')
    mocks.getFile.mockResolvedValue(file)
    mocks.fetchBuffer.mockResolvedValue(Buffer.from('source'))
    mocks.getSecretProvenance.mockResolvedValue({ status: 'exact', entries: [] })
  })

  it('authorizes the canonical file before performing a bounded content read', async () => {
    await expect(
      readWorkspaceFileContent.execute({
        principal: createSessionPrincipal(),
        input: {
          fileId: 'file-1',
          assertedWorkspaceId: 'workspace-1',
          includeDeleted: true,
          maxBytes: 512,
        },
      })
    ).resolves.toEqual({ file, content: Buffer.from('source') })

    expect(mocks.loadContext).toHaveBeenCalledWith('file-1', {
      includeDeleted: true,
      includeChatUploads: true,
    })
    expect(mocks.getFile).toHaveBeenCalledWith('workspace-1', 'file-1', {
      includeDeleted: true,
      throwOnError: true,
      includeChatUploads: true,
    })
    expect(mocks.fetchBuffer).toHaveBeenCalledWith(file, { maxBytes: 512 })
    expect(mocks.getSecretProvenance).not.toHaveBeenCalled()
  })

  it('conceals an asserted-workspace mismatch before authorization or storage reads', async () => {
    await expect(
      readWorkspaceFileContent.execute({
        principal: createSessionPrincipal(),
        input: { fileId: 'file-1', assertedWorkspaceId: 'workspace-2' },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'File not found' })

    expect(mocks.resolvePermission).not.toHaveBeenCalled()
    expect(mocks.getFile).not.toHaveBeenCalled()
    expect(mocks.fetchBuffer).not.toHaveBeenCalled()
  })
})
