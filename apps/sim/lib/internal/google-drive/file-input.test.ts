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

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)

vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockProcessSingleFileToUserFile } = fileUtilsMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns

import { resolveGoogleDriveUploadFile } from '@/lib/internal/google-drive/file-input'

const file = { key: 'workspace/file.txt', name: 'file.txt', size: 4 }

describe('resolveGoogleDriveUploadFile', () => {
  beforeEach(() => {
    mockProcessSingleFileToUserFile.mockReturnValue({ ...file, type: 'text/plain' })
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('test'),
      contentType: 'text/plain',
    })
  })

  it('fails closed on denied access', async () => {
    mockAssertToolFileAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )

    await expect(
      resolveGoogleDriveUploadFile(file, {
        requestId: 'request-1',
        userId: 'user-1',
      })
    ).rejects.toMatchObject({
      status: 404,
      body: { success: false, error: 'File not found' },
    })
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
  })
})
