/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext, UserFile } from '@/executor/types'

const { presign, download, metadata, permission } = vi.hoisted(() => ({
  presign: vi.fn(),
  download: vi.fn(),
  metadata: vi.fn(),
  permission: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: { hasCloudStorage: () => true, generatePresignedDownloadUrl: presign },
  getFileMetadata: metadata,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: download,
}))

vi.mock('@/lib/uploads/server/metadata', () => ({
  getFileMetadataByKey: metadata,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: permission,
}))

import { resolveTrustedFileContext } from '@/lib/uploads/utils/file-utils'
import {
  attachLargeFileRemoteUrls,
  uploadLargeFilesToProvider,
} from '@/providers/file-attachments.server'
import type { ProviderRequest } from '@/providers/types'

/** Authorization and key inference are real: mocking either hid this pre-existing refusal. */
describe('provider attachment storage-key authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
                  ? { kind: 'session', userId: 'acting-user', sessionId: 'session-1' }
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
})
