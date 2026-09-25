import { beforeEach, describe, expect, it, vi } from 'vitest'

const fileMocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  docNotReadyResponse: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  isPayloadSizeLimitError: vi.fn(),
  processFilesToUserFiles: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: fileMocks.assertToolFileAccess,
}))
vi.mock('@/lib/core/utils/stream-limits', () => ({
  isPayloadSizeLimitError: fileMocks.isPayloadSizeLimitError,
}))
vi.mock('@/lib/uploads/shared/types', () => ({
  MAX_BUFFERED_TRANSFER_BYTES: 50 * 1024 * 1024,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: fileMocks.processFilesToUserFiles,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: fileMocks.downloadServableFileFromStorage,
}))
vi.mock('@/lib/uploads/utils/servable-file-response', () => ({
  docNotReadyResponse: fileMocks.docNotReadyResponse,
}))

import { resolveAgiloftAttachmentFile } from '@/lib/internal/agiloft/file-input'

const RAW_FILE = {
  id: 'file-1',
  name: 'evidence.txt',
  url: '/api/files/serve/file-1',
  size: 5,
  type: 'text/plain',
  key: 'workspace-1/file-1',
}

const USER_FILE = {
  ...RAW_FILE,
  context: 'workspace',
}

describe('Agiloft attachment file resolution', () => {
  beforeEach(() => {
    fileMocks.processFilesToUserFiles.mockReturnValue([USER_FILE])
    fileMocks.assertToolFileAccess.mockResolvedValue(null)
    fileMocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('hello'),
      contentType: 'text/plain',
    })
    fileMocks.docNotReadyResponse.mockReturnValue(null)
    fileMocks.isPayloadSizeLimitError.mockReturnValue(false)
  })

  it.each(['workspace', 'mothership', 'execution', 'copilot', 'knowledge-base', 'chat', 'general'])(
    'preserves fail-closed authorization for %s file inputs',
    async (context) => {
      const file = { ...RAW_FILE, context, key: `${context}/file-1` }
      const userFile = { ...USER_FILE, ...file }
      fileMocks.processFilesToUserFiles.mockReturnValueOnce([userFile])

      const result = await resolveAgiloftAttachmentFile(file, {
        userId: 'user-1',
        requestId: 'request-1',
      })

      expect(result).toEqual({ userFile, buffer: Buffer.from('hello') })
      expect(fileMocks.assertToolFileAccess).toHaveBeenCalledWith(
        userFile.key,
        'user-1',
        'request-1',
        expect.anything()
      )
    }
  )
})
