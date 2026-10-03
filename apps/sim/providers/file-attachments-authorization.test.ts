import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock, uploadsMockFns } from '@sim/testing/mocks/uploads.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext, UserFile } from '@/executor/types'

vi.mock('@/lib/uploads', () => uploadsMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { resolveTrustedFileContext } from '@/lib/uploads/utils/file-utils'
import {
  attachLargeFileRemoteUrls,
  uploadLargeFilesToProvider,
} from '@/providers/file-attachments.server'
import type { ProviderRequest } from '@/providers/types'

const presign = storageServiceMockFns.mockGeneratePresignedDownloadUrl
const download = fileUtilsServerMockFns.mockDownloadServableFileFromStorage
const metadata = uploadsMetadataMockFns.mockGetFileMetadataByKey
const permission = permissionsMockFns.mockGetUserEntityPermissions

/** Authorization and key inference are real: mocking either hid this pre-existing refusal. */
describe('provider attachment storage-key authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    storageServiceMockFns.mockHasCloudStorage.mockReturnValue(true)
    uploadsMockFns.mockGetFileMetadata.mockImplementation((...args) => metadata(...args))
  })

  it.each(
    (['workspace', 'execution', 'chat', 'copilot', 'knowledge-base'] as const).flatMap((context) =>
      (['standalone', 'session', 'system'] as const).map((caller) => ({ context, caller }))
    )
  )(
    'rejects unprefixed $context keys for $caller before reading or signing bytes',
    async ({ context, caller }) => {
      const file: UserFile = {
        id: 'file-1',
        name: 'document.pdf',
        key: 'legacy-file-id/document.pdf',
        url: '',
        size: 10 * 1024 * 1024,
        type: 'application/pdf',
        context,
      }
      const request: ProviderRequest = {
        model: 'gpt-4.1',
        userId: 'billing-owner',
        messages: [{ role: 'user', content: 'Read this file', files: [file] }],
      }
      const executionContext =
        caller === 'standalone'
          ? undefined
          : ({
              workflowId: 'workflow-1',
              workspaceId: 'workspace-1',
              executionId: 'execution-1',
              userId: 'billing-owner',
              principal:
                caller === 'session'
                  ? createSessionPrincipal({ userId: 'acting-user' })
                  : {
                      kind: 'system',
                      serviceId: 'chat',
                      workspaceId: 'workspace-1',
                      workflowId: 'workflow-1',
                    },
            } as ExecutionContext)

      expect(resolveTrustedFileContext(file.key, file.context)).toBe(context)
      await expect(attachLargeFileRemoteUrls(request, 'openai', executionContext)).rejects.toThrow()
      expect(presign).not.toHaveBeenCalled()

      file.remoteUrl = 'https://storage.example.com/forged'
      await expect(
        uploadLargeFilesToProvider(request, 'openai', executionContext)
      ).rejects.toThrow()
      expect(download).not.toHaveBeenCalled()
      expect(metadata).not.toHaveBeenCalled()
      expect(permission).not.toHaveBeenCalled()
    }
  )

  it('allows standalone provider reads of authorized mothership attachments in workspace storage', async () => {
    const file: UserFile = {
      id: 'attachment-1',
      name: 'document.pdf',
      key: 'workspace/workspace-1/attachment-1/document.pdf',
      url: '',
      size: 10 * 1024 * 1024,
      type: 'application/pdf',
      context: 'workspace',
    }
    metadata.mockResolvedValue({
      id: file.id,
      key: file.key,
      workspaceId: 'workspace-1',
      userId: 'uploader',
      context: 'mothership',
      deletedAt: null,
    })
    permission.mockResolvedValue('read')
    presign.mockResolvedValue('https://storage.example.com/signed')

    await attachLargeFileRemoteUrls(
      {
        model: 'gpt-4.1',
        userId: 'reader',
        messages: [{ role: 'user', content: 'Read the attachment', files: [file] }],
      },
      'openai'
    )

    expect(permission).toHaveBeenCalledWith('reader', 'workspace', 'workspace-1')
    expect(presign).toHaveBeenCalledWith(file.key, 'workspace', 3600)
    expect(file.remoteUrl).toBe('https://storage.example.com/signed')
  })
})
