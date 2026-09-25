import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  createS3Client: vi.fn(),
  destroy: vi.fn(),
  downloadServableFileFromStorage: vi.fn(),
  getSignedUrl: vi.fn(),
  processSingleFileToUserFile: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/internal/s3/client', () => ({
  createS3Client: mocks.createS3Client,
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mocks.getSignedUrl,
}))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  processSingleFileToUserFile: mocks.processSingleFileToUserFile,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mocks.downloadServableFileFromStorage,
}))

import { S3OperationError } from '@/lib/internal/s3/errors'
import { executeS3PutObject } from '@/lib/internal/s3/operations'

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
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.processSingleFileToUserFile.mockReturnValue({
      key: 'workspace/file-key',
      name: 'file.txt',
      size: 5,
      type: 'text/plain',
    })
    mocks.downloadServableFileFromStorage.mockResolvedValue({
      buffer: Buffer.from('hello'),
      contentType: 'text/plain',
    })
  })

  it('fails closed when stored-file access is denied', async () => {
    mocks.assertToolFileAccess.mockResolvedValue(new Response(null, { status: 404 }))

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
