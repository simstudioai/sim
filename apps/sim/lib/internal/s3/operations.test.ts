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
  createS3Client: vi.fn(),
  destroy: vi.fn(),
  getSignedUrl: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/internal/s3/client', () => ({
  createS3Client: mocks.createS3Client,
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mocks.getSignedUrl,
}))
vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)
vi.mock('@/lib/uploads/utils/file-utils', () => fileUtilsMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)

import { S3OperationError } from '@/lib/internal/s3/errors'
import { executeS3PutObject } from '@/lib/internal/s3/operations'

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadServableFileFromStorage } = fileUtilsServerMockFns
const { mockProcessSingleFileToUserFile } = fileUtilsMockFns

const CONNECTION = {
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  region: 'us-east-1',
}

const CONTEXT = {
  headers: new Headers(),
  requestId: 'request-1',
  userId: 'user-1',
}

describe('S3 operations', () => {
  beforeEach(() => {
    mocks.createS3Client.mockReturnValue({ send: mocks.send, destroy: mocks.destroy })
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockProcessSingleFileToUserFile.mockReturnValue({
      key: 'workspace/file-key',
      name: 'file.txt',
      size: 5,
      type: 'text/plain',
    })
    mockDownloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('hello'),
      contentType: 'text/plain',
    })
  })

  it('fails closed when stored-file access is denied', async () => {
    mockAssertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))

    await expect(
      executeS3PutObject(
        {
          ...CONNECTION,
          bucketName: 'bucket',
          objectKey: 'file.txt',
          file: { key: 'workspace/file-key', name: 'file.txt', size: 5 },
        },
        CONTEXT
      )
    ).rejects.toEqual(new S3OperationError('File not found', 404))
    expect(mocks.createS3Client).not.toHaveBeenCalled()
  })
})
