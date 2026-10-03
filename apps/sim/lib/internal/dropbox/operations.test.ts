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

vi.mock('@/lib/internal/dropbox/client', () => {
  class DropboxUploadError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
    }
  }
  class DropboxClient {
    constructor(token: string, signal?: AbortSignal) {
      mocks.clientConstructed(token, signal)
    }

    upload = mocks.upload
  }
  return { DropboxClient, DropboxUploadError }
})
vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)

const { mockProcessFilesToUserFiles } = fileUtilsMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns
const { mockAssertToolFileAccess } = filesAuthorizationMockFns

import { executeDropboxUpload } from '@/lib/internal/dropbox/operations'

const rawFile = { key: 'uploads/file.pdf', name: 'file.pdf', size: 4 }
const userFile = { ...rawFile, type: 'application/pdf' }

describe('executeDropboxUpload', () => {
  beforeEach(() => {
    mockProcessFilesToUserFiles.mockReturnValue([userFile])
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadServableFileFromStorage.mockResolvedValue({ buffer: Buffer.from('file') })
    mocks.upload.mockResolvedValue({ id: 'dropbox-1', name: 'file.pdf' })
  })

  it('does not load bytes for an unauthorized file', async () => {
    mockAssertToolFileAccess.mockResolvedValue(
      Response.json({ success: false, error: 'File not found' }, { status: 404 })
    )
    const response = await executeDropboxUpload(
      { accessToken: 'token', path: '/file.pdf', file: rawFile },
      { userId: 'user-1', requestId: 'request-1' }
    )

    expect(response.status).toBe(404)
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})
