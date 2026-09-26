import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  uploadClickUpAttachment: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)
vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock('@/lib/internal/clickup/client', () => ({
  uploadClickUpAttachment: mocks.uploadClickUpAttachment,
}))

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockProcessFilesToUserFiles } = fileUtilsMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns

import { executeClickUpUploadAttachment } from '@/lib/internal/clickup/operations'

const rawFile = { key: 'uploads/file.txt', name: 'file.txt', size: 4 }
const userFile = { ...rawFile, type: 'text/plain' }

describe('executeClickUpUploadAttachment', () => {
  beforeEach(() => {
    mockProcessFilesToUserFiles.mockReturnValue([userFile])
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockResolvedValue({
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

    expect(mockProcessFilesToUserFiles).toHaveBeenCalledWith(
      [rawFile],
      'request-1',
      expect.anything()
    )
    expect(mockAssertToolFileAccess).toHaveBeenCalledWith(
      userFile.key,
      'user-1',
      'request-1',
      expect.anything()
    )
  })
})
