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
  clientConstructed: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('@/lib/internal/box/client', () => {
  class BoxUploadError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
    }
  }
  class BoxClient {
    constructor(token: string, signal?: AbortSignal) {
      mocks.clientConstructed(token, signal)
    }

    upload = mocks.upload
  }
  return { BoxClient, BoxUploadError }
})

vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

const { mockProcessFilesToUserFiles } = fileUtilsMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns
const { mockAssertToolFileAccess } = filesAuthorizationMockFns

import { executeBoxUploadFile } from '@/lib/internal/box/operations'

const rawFile = { key: 'uploads/file.pdf', name: 'file.pdf', size: 4 }
const userFile = { ...rawFile, type: 'application/pdf' }

describe('executeBoxUploadFile', () => {
  beforeEach(() => {
    mockProcessFilesToUserFiles.mockReturnValue([userFile])
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockResolvedValue({ buffer: Buffer.from('file') })
    mocks.upload.mockResolvedValue({ id: 'box-1', name: 'override.pdf', size: 4 })
  })

  it('never materializes an unauthorized file', async () => {
    mockAssertToolFileAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )
    const response = await executeBoxUploadFile(
      { accessToken: 'token', parentFolderId: '0', file: rawFile },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(404)
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})
