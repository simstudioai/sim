import { fileUtilsMock, fileUtilsMockFns } from '@sim/testing/mocks/file-utils.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('@/lib/uploads/utils/file', () => fileUtilsMock)
vi.mock('@/lib/uploads/utils/file.server', () => fileUtilsServerMock)

import { runWithAwsSession } from '@/lib/internal/aws/credentials'
import { S3OperationError } from '@/lib/internal/s3/errors'
import { executeS3PresignedUrl, executeS3PutObject } from '@/lib/internal/s3/operations'

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

describe('S3 presigned URLs', () => {
  const NOW = new Date('2030-01-01T00:00:00.000Z')
  const SESSION = {
    accessKeyId: 'ASIASESSIONKEY',
    secretAccessKey: 'session-secret',
    sessionToken: 'session-token',
    durationSeconds: 3600,
    expiration: new Date(NOW.getTime() + 3600 * 1000),
  }
  const presign = (accessKeyId: string, expiresIn: number) =>
    executeS3PresignedUrl({
      accessKeyId,
      secretAccessKey: 'secret',
      region: 'us-east-1',
      bucketName: 'bucket',
      objectKey: 'report.csv',
      method: 'get',
      expiresIn,
    })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    mocks.createS3Client.mockReturnValue({ send: mocks.send, destroy: mocks.destroy })
    mocks.getSignedUrl.mockResolvedValue(
      'https://bucket.s3.amazonaws.com/report.csv?X-Amz-Signature=x'
    )
  })
  afterEach(() => vi.useRealTimers())

  it('refuses an expiry past the end of the role session that signs it', async () => {
    await expect(
      runWithAwsSession(SESSION, () => presign(SESSION.accessKeyId, 7200))
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/3600 seconds.*session duration/),
    })
    expect(mocks.getSignedUrl).not.toHaveBeenCalled()
  })

  it('allows the full session duration after the time spent minting the session', async () => {
    vi.setSystemTime(NOW.getTime() + 750)

    const result = await runWithAwsSession(SESSION, () => presign(SESSION.accessKeyId, 3600))

    expect(mocks.getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      expiresIn: 3600,
    })
    expect(result.output.expiresAt).toBe(SESSION.expiration.toISOString())
  })

  it('reports an expiry the role session outlives', async () => {
    const result = await runWithAwsSession(SESSION, () => presign(SESSION.accessKeyId, 3600))

    expect(result.output.expiresAt).toBe('2030-01-01T01:00:00.000Z')
    expect(mocks.getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      expiresIn: 3600,
    })
  })

  it('keeps the full seven days for long-lived access keys', async () => {
    const result = await presign('AKIASTATICKEY', 604800)

    expect(result.output.expiresAt).toBe('2030-01-08T00:00:00.000Z')
  })
})
