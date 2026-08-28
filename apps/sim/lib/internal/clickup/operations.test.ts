/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  processFilesToUserFiles: vi.fn(),
  uploadClickUpAttachment: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processFilesToUserFiles: mocks.processFilesToUserFiles,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFileFromStorage,
}))
vi.mock('@/lib/internal/clickup/client', () => ({
  uploadClickUpAttachment: mocks.uploadClickUpAttachment,
}))

import { executeClickUpUploadAttachment } from '@/lib/internal/clickup/operations'

const rawFile = { key: 'uploads/file.txt', name: 'file.txt', size: 4 }
const userFile = { ...rawFile, type: 'text/plain' }

describe('executeClickUpUploadAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.processFilesToUserFiles.mockReturnValue([userFile])
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('file'),
      contentType: 'text/plain',
    })
    mocks.uploadClickUpAttachment.mockResolvedValue({ id: 'attachment-1' })
  })

  it('accepts serialized advanced-mode file inputs without weakening authorization', async () => {
    await executeClickUpUploadAttachment(
      { accessToken: 'token', taskId: 'task-1', file: JSON.stringify(rawFile) },
      { requestId: 'request-1', userId: 'user-1' }
    )

    expect(mocks.processFilesToUserFiles).toHaveBeenCalledWith(
      [rawFile],
      'request-1',
      expect.anything()
    )
    expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
      userFile.key,
      'user-1',
      'request-1',
      expect.anything()
    )
  })
})
