/**
 * Tests for GCS client functionality
 *
 * @vitest-environment node
 */
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFile,
  mockBucket,
  mockStorageInstance,
  mockStorageConstructor,
  mockGetAccessToken,
  mockEnv,
  mockGcsConfig,
} = vi.hoisted(() => {
  const mockFile = {
    save: vi.fn(),
    createReadStream: vi.fn(),
    getMetadata: vi.fn(),
    delete: vi.fn(),
    getSignedUrl: vi.fn(),
    copy: vi.fn(),
  }
  const mockBucket = { file: vi.fn(() => mockFile) }
  const mockGetAccessToken = vi.fn()
  const mockStorageInstance = {
    bucket: vi.fn(() => mockBucket),
    authClient: { getAccessToken: mockGetAccessToken },
  }
  const mockEnv: Record<string, string | undefined> = {
    GCS_BUCKET_NAME: 'test-bucket',
  }
  const mockGcsConfig = { bucket: 'test-bucket' }
  return {
    mockFile,
    mockBucket,
    mockStorageInstance,
    mockStorageConstructor: vi.fn().mockImplementation(
      class {
        constructor() {
          // biome-ignore lint/correctness/noConstructorReturn: vitest constructs mocks via Reflect.construct; returning the object overrides the instance so `new Storage()` yields the shared mock the tests assert on
          return mockStorageInstance
        }
      }
    ),
    mockGetAccessToken,
    mockEnv,
    mockGcsConfig,
  }
})

vi.mock('@google-cloud/storage', () => ({
  Storage: mockStorageConstructor,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
  getEnv: (key: string) => mockEnv[key],
  isTruthy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value.toLowerCase() === 'true' || value === '1' : Boolean(value),
  isFalsy: (value: string | boolean | number | undefined) =>
    typeof value === 'string' ? value.toLowerCase() === 'false' || value === '0' : value === false,
}))

vi.mock('@/lib/uploads/config', () => ({
  GCS_CONFIG: mockGcsConfig,
}))

import {
  abortGcsMultipartUpload,
  completeGcsMultipartUpload,
  deleteFromGcs,
  deleteGcsObjectVersion,
  downloadFromGcs,
  getGcsClient,
  getGcsMultipartPartUrls,
  getGcsPresignedUploadUrl,
  getPresignedUrlWithConfig,
  headGcsObject,
  initiateGcsMultipartUpload,
  listGcsMultipartParts,
  resetGcsClientForTesting,
  uploadGcsPart,
  uploadToGcs,
} from '@/lib/uploads/providers/google-cloud-storage/client'

const mockFetch = vi.fn()

describe('GCS Client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockEnv.GCS_PROJECT_ID = undefined
    mockEnv.GCS_CREDENTIALS_JSON = undefined
    mockGetAccessToken.mockResolvedValue('test-access-token')
    resetGcsClientForTesting()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('getGcsClient', () => {
    it('should initialize with Application Default Credentials when no inline credentials are set', async () => {
      const client = await getGcsClient()

      expect(client).toBeDefined()
      expect(mockStorageConstructor).toHaveBeenCalledWith({})
    })

    it('should initialize with inline credentials and project id when provided', async () => {
      mockEnv.GCS_PROJECT_ID = 'my-project'
      mockEnv.GCS_CREDENTIALS_JSON = JSON.stringify({
        client_email: 'svc@my-project.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      })

      await getGcsClient()

      expect(mockStorageConstructor).toHaveBeenCalledWith({
        projectId: 'my-project',
        credentials: {
          client_email: 'svc@my-project.iam.gserviceaccount.com',
          private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
        },
      })
    })

    it('should fall back to the project id embedded in the credentials JSON', async () => {
      mockEnv.GCS_CREDENTIALS_JSON = JSON.stringify({
        client_email: 'svc@my-project.iam.gserviceaccount.com',
        private_key: 'key',
        project_id: 'embedded-project',
      })

      await getGcsClient()

      expect(mockStorageConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'embedded-project' })
      )
    })

    it('should reject invalid credentials JSON', async () => {
      mockEnv.GCS_CREDENTIALS_JSON = 'not-json'

      await expect(getGcsClient()).rejects.toThrow('GCS_CREDENTIALS_JSON is not valid JSON')
    })

    it('should reject credentials JSON missing required fields', async () => {
      mockEnv.GCS_CREDENTIALS_JSON = JSON.stringify({ client_email: 'svc@example.com' })

      await expect(getGcsClient()).rejects.toThrow(
        'GCS_CREDENTIALS_JSON must contain client_email and private_key'
      )
    })

    it('should cache the client across calls', async () => {
      await getGcsClient()
      await getGcsClient()

      expect(mockStorageConstructor).toHaveBeenCalledTimes(1)
    })
  })

  describe('uploadToGcs', () => {
    it('adds a generation-zero precondition for an immutable upload', async () => {
      mockFile.save.mockResolvedValueOnce(undefined)

      await uploadToGcs(
        Buffer.from('new'),
        'kb/new.txt',
        'text/plain',
        undefined,
        undefined,
        true,
        { uploadId: 'attempt-1' },
        true
      )

      expect(mockFile.save).toHaveBeenCalledWith(
        Buffer.from('new'),
        expect.objectContaining({
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { metadata: expect.objectContaining({ uploadId: 'attempt-1' }) },
        })
      )
    })

    it('should upload a file to GCS and return file info', async () => {
      mockFile.save.mockResolvedValueOnce(undefined)

      const file = Buffer.from('test content')
      const result = await uploadToGcs(file, 'test-file.txt', 'text/plain')

      expect(mockStorageInstance.bucket).toHaveBeenCalledWith('test-bucket')
      expect(mockBucket.file).toHaveBeenCalledWith(expect.stringContaining('test-file.txt'))
      expect(mockFile.save).toHaveBeenCalledWith(file, {
        contentType: 'text/plain',
        resumable: false,
        metadata: {
          metadata: expect.objectContaining({
            originalName: 'test-file.txt',
            uploadedAt: expect.any(String),
          }),
        },
      })

      expect(result).toEqual({
        path: expect.stringContaining('/api/files/serve/'),
        key: expect.stringContaining('test-file.txt'),
        name: 'test-file.txt',
        size: file.length,
        type: 'text/plain',
      })
    })

    it('should preserve the key when preserveKey is set', async () => {
      mockFile.save.mockResolvedValueOnce(undefined)

      const file = Buffer.from('content')
      const result = await uploadToGcs(
        file,
        'workspace/ws-1/file.txt',
        'text/plain',
        { bucket: 'custom-bucket' },
        file.length,
        true
      )

      expect(mockStorageInstance.bucket).toHaveBeenCalledWith('custom-bucket')
      expect(mockBucket.file).toHaveBeenCalledWith('workspace/ws-1/file.txt')
      expect(result.key).toBe('workspace/ws-1/file.txt')
    })

    it('should handle upload errors', async () => {
      mockFile.save.mockRejectedValueOnce(new Error('Upload failed'))

      await expect(uploadToGcs(Buffer.from('x'), 'f.txt', 'text/plain')).rejects.toThrow(
        'Upload failed'
      )
    })
  })

  describe('presigned URLs', () => {
    it('should generate a v4 read signed URL', async () => {
      mockFile.getSignedUrl.mockResolvedValueOnce(['https://example.com/signed-read'])

      const url = await getPresignedUrlWithConfig('test-file.txt', { bucket: 'custom' }, 1800)

      expect(mockStorageInstance.bucket).toHaveBeenCalledWith('custom')
      expect(mockFile.getSignedUrl).toHaveBeenCalledWith({
        version: 'v4',
        action: 'read',
        expires: expect.any(Number),
      })
      expect(url).toBe('https://example.com/signed-read')
    })

    it('should generate a v4 write signed URL with signed metadata headers', async () => {
      mockFile.getSignedUrl.mockResolvedValueOnce(['https://example.com/signed-write'])

      const result = await getGcsPresignedUploadUrl(
        'workspace/file.txt',
        'text/plain',
        { originalName: 'file.txt', workspaceId: 'ws-1', simuploadid: 'receipt-1' },
        { bucket: 'test-bucket' },
        3600
      )

      expect(mockFile.getSignedUrl).toHaveBeenCalledWith({
        version: 'v4',
        action: 'write',
        expires: expect.any(Number),
        contentType: 'text/plain',
        extensionHeaders: expect.objectContaining({
          'x-goog-if-generation-match': '0',
          'x-goog-meta-originalName': 'file.txt',
          'x-goog-meta-workspaceId': 'ws-1',
          'x-goog-meta-simuploadid': 'receipt-1',
        }),
      })
      expect(result.url).toBe('https://example.com/signed-write')
      expect(result.signedHeaders).toEqual(
        expect.objectContaining({
          'Content-Type': 'text/plain',
          'x-goog-if-generation-match': '0',
          'x-goog-meta-workspaceId': 'ws-1',
          'x-goog-meta-simuploadid': 'receipt-1',
        })
      )
    })
  })

  describe('downloadFromGcs', () => {
    it('should download a file from GCS', async () => {
      mockFile.createReadStream.mockReturnValueOnce(
        Readable.from([Buffer.from('chunk1'), Buffer.from('chunk2')])
      )

      const result = await downloadFromGcs('test-file.txt')

      expect(mockBucket.file).toHaveBeenCalledWith('test-file.txt')
      expect(result).toBeInstanceOf(Buffer)
      expect(result.toString()).toBe('chunk1chunk2')
    })

    it('should reject before streaming when the known size exceeds the limit', async () => {
      mockFile.getMetadata.mockResolvedValueOnce([{ size: '1024' }])

      await expect(downloadFromGcs('big.bin', { bucket: 'test-bucket' }, 10)).rejects.toThrow(
        'storage download exceeds maximum size'
      )
      expect(mockFile.createReadStream).not.toHaveBeenCalled()
    })

    it('should handle download errors', async () => {
      const failing = new Readable({
        read() {
          this.destroy(new Error('Stream error'))
        },
      })
      mockFile.createReadStream.mockReturnValueOnce(failing)

      await expect(downloadFromGcs('test-file.txt')).rejects.toThrow('Stream error')
    })

    it('destroys the response stream when cancelled', async () => {
      const controller = new AbortController()
      const stream = new Readable({
        read() {},
      })
      const destroy = vi.spyOn(stream, 'destroy')
      mockFile.createReadStream.mockReturnValueOnce(stream)

      const download = downloadFromGcs(
        'test-file.txt',
        { bucket: 'test-bucket' },
        undefined,
        controller.signal
      )
      await vi.waitFor(() => expect(mockFile.createReadStream).toHaveBeenCalled())
      controller.abort(new Error('cancelled'))

      await expect(download).rejects.toThrow('cancelled')
      expect(destroy).toHaveBeenCalledWith()
    })
  })

  describe('headGcsObject', () => {
    it('should return size and content type when the object exists', async () => {
      mockFile.getMetadata.mockResolvedValueOnce([
        {
          size: '2048',
          contentType: 'text/csv',
          generation: '42',
          metadata: { uploadid: 'upload-1', simuploadid: 'receipt-1' },
        },
      ])

      const result = await headGcsObject('data.csv')

      expect(result).toEqual({
        size: 2048,
        contentType: 'text/csv',
        uploadId: 'upload-1',
        version: '42',
        metadata: { uploadid: 'upload-1', simuploadid: 'receipt-1' },
      })
    })

    it('should return null when the object is missing', async () => {
      mockFile.getMetadata.mockRejectedValueOnce(
        Object.assign(new Error('Not Found'), { code: 404 })
      )

      const result = await headGcsObject('missing.txt')

      expect(result).toBeNull()
    })

    it('should rethrow non-404 errors', async () => {
      mockFile.getMetadata.mockRejectedValueOnce(
        Object.assign(new Error('Forbidden'), { code: 403 })
      )

      await expect(headGcsObject('secret.txt')).rejects.toThrow('Forbidden')
    })
  })

  describe('direct upload object lifecycle', () => {
    it('deletes the upload object only at the inspected generation', async () => {
      mockFile.delete.mockResolvedValueOnce(undefined)

      await deleteGcsObjectVersion({
        key: 'workspace/workspace-1/file.bin',
        generation: '42',
        customConfig: { bucket: 'test-bucket' },
      })

      expect(mockBucket.file).toHaveBeenCalledWith('workspace/workspace-1/file.bin', {
        generation: '42',
      })
      expect(mockFile.delete).toHaveBeenCalledWith({ ifGenerationMatch: '42' })
    })
  })

  describe('deleteFromGcs', () => {
    it('should delete a file, ignoring missing objects', async () => {
      mockFile.delete.mockResolvedValueOnce(undefined)

      await deleteFromGcs('test-file.txt')

      expect(mockBucket.file).toHaveBeenCalledWith('test-file.txt')
      expect(mockFile.delete).toHaveBeenCalledWith({ ignoreNotFound: true })
    })

    it('should handle delete errors', async () => {
      mockFile.delete.mockRejectedValueOnce(new Error('Delete failed'))

      await expect(deleteFromGcs('test-file.txt')).rejects.toThrow('Delete failed')
    })
  })

  describe('multipart uploads (XML API)', () => {
    it('lists provider-authoritative parts across pagination', async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(
            '<ListPartsResult><Part><PartNumber>1</PartNumber><ETag>&quot;etag-1&quot;</ETag><Size>8</Size></Part><IsTruncated>true</IsTruncated><NextPartNumberMarker>1</NextPartNumberMarker></ListPartsResult>',
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            '<ListPartsResult><Part><PartNumber>2</PartNumber><ETag>&quot;etag-2&quot;</ETag><Size>3</Size></Part><IsTruncated>false</IsTruncated></ListPartsResult>',
            { status: 200 }
          )
        )

      await expect(
        listGcsMultipartParts('workspace/ws-1/file.bin', 'provider-upload-1')
      ).resolves.toEqual([
        { partNumber: 1, etag: '"etag-1"', size: 8 },
        { partNumber: 2, etag: '"etag-2"', size: 3 },
      ])
      expect(mockFetch.mock.calls[1][0]).toContain(
        'uploadId=provider-upload-1&part-number-marker=1'
      )
    })

    it('should initiate a multipart upload and parse the UploadId', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          '<InitiateMultipartUploadResult><UploadId>upload-123</UploadId></InitiateMultipartUploadResult>',
          { status: 200 }
        )
      )

      const result = await initiateGcsMultipartUpload({
        fileName: 'large.csv',
        contentType: 'text/csv',
        fileSize: 100,
        customKey: 'workspace/ws-1/large.csv',
        purpose: 'workspace',
      })

      expect(result).toEqual({
        uploadId: 'upload-123',
        key: expect.stringMatching(/^\.sim-multipart\/[0-9a-f-]+\/workspace\/ws-1\/large\.csv$/),
      })

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe(`https://storage.googleapis.com/test-bucket/${result.key}?uploads`)
      expect(init.method).toBe('POST')
      const completionId = result.key.split('/')[1]
      expect(init.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer test-access-token',
          'Content-Type': 'text/csv',
          'x-goog-meta-purpose': 'workspace',
          'x-goog-meta-sim-upload-id': completionId,
        })
      )
    })

    it('should throw when the initiate response has no UploadId', async () => {
      mockFetch.mockResolvedValueOnce(new Response('<Empty/>', { status: 200 }))

      await expect(
        initiateGcsMultipartUpload({ fileName: 'x.csv', contentType: 'text/csv', fileSize: 1 })
      ).rejects.toThrow('no UploadId in response')
    })

    it('should surface XML API errors with status details', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('<Error><Message>denied</Message></Error>', {
          status: 403,
          statusText: 'Forbidden',
        })
      )

      await expect(
        initiateGcsMultipartUpload({ fileName: 'x.csv', contentType: 'text/csv', fileSize: 1 })
      ).rejects.toThrow('403 Forbidden')
    })

    it('should upload a part and return its ETag', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { ETag: '"etag-1"' } })
      )

      const part = await uploadGcsPart('key.csv', 'upload-123', 1, Buffer.from('data'))

      expect(part).toEqual({ PartNumber: 1, ETag: '"etag-1"' })
      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe(
        'https://storage.googleapis.com/test-bucket/key.csv?partNumber=1&uploadId=upload-123'
      )
      expect(init.method).toBe('PUT')
    })

    it('should throw when a part upload returns no ETag', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

      await expect(uploadGcsPart('key.csv', 'upload-123', 1, Buffer.from('data'))).rejects.toThrow(
        'no ETag'
      )
    })

    it('should generate signed part URLs covering partNumber and uploadId', async () => {
      mockFile.getSignedUrl
        .mockResolvedValueOnce(['https://example.com/part-1'])
        .mockResolvedValueOnce(['https://example.com/part-2'])

      const expires = new Date('2026-01-01T00:02:00.000Z')
      const urls = await getGcsMultipartPartUrls(
        'key.csv',
        'upload-123',
        [1, 2],
        undefined,
        expires
      )

      expect(urls).toEqual([
        { partNumber: 1, url: 'https://example.com/part-1' },
        { partNumber: 2, url: 'https://example.com/part-2' },
      ])
      // The caller owns the lifetime and advertises the matching `expiresAt`; signing to a
      // window this function picked itself is how the two drift apart.
      expect(mockFile.getSignedUrl).toHaveBeenCalledWith({
        version: 'v4',
        action: 'write',
        expires,
        queryParams: { partNumber: '1', uploadId: 'upload-123' },
      })
    })

    it('should complete a multipart upload with sorted parts XML', async () => {
      mockFetch.mockResolvedValueOnce(new Response('<Complete/>', { status: 200 }))

      const result = await completeGcsMultipartUpload('kb/uuid-file.txt', 'upload-123', [
        { PartNumber: 2, ETag: '"etag-2"' },
        { PartNumber: 1, ETag: '"etag-1"' },
      ])

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe(
        'https://storage.googleapis.com/test-bucket/kb/uuid-file.txt?uploadId=upload-123'
      )
      expect(init.method).toBe('POST')
      expect(init.body).toBe(
        '<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>&quot;etag-1&quot;</ETag></Part><Part><PartNumber>2</PartNumber><ETag>&quot;etag-2&quot;</ETag></Part></CompleteMultipartUpload>'
      )
      expect(result).toEqual({
        location: 'https://storage.googleapis.com/test-bucket/kb/uuid-file.txt',
        path: '/api/files/serve/kb%2Fuuid-file.txt',
        key: 'kb/uuid-file.txt',
      })
    })

    it('finalizes new multipart uploads through a create-only canonical copy', async () => {
      mockFetch.mockResolvedValueOnce(new Response('<Complete/>', { status: 200 }))
      mockFile.getMetadata.mockResolvedValueOnce([{ metadata: { 'sim-upload-id': 'receipt-1' } }])
      mockFile.copy.mockResolvedValueOnce([mockFile, {}])
      mockFile.delete.mockResolvedValueOnce(undefined)

      const result = await completeGcsMultipartUpload(
        '.sim-multipart/receipt-1/workspace/ws-1/large.csv',
        'upload-123',
        [{ PartNumber: 1, ETag: 'etag-1' }]
      )

      expect(mockFile.copy).toHaveBeenCalledWith(mockFile, {
        preconditionOpts: { ifGenerationMatch: 0 },
      })
      expect(mockFile.delete).toHaveBeenCalledWith({ ignoreNotFound: true })
      expect(result).toEqual({
        location: 'https://storage.googleapis.com/test-bucket/workspace/ws-1/large.csv',
        path: '/api/files/serve/workspace%2Fws-1%2Flarge.csv',
        key: 'workspace/ws-1/large.csv',
      })
    })

    it('returns the immutable canonical object when multipart completion is retried', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('<Error/>', { status: 404, statusText: 'Not Found' })
      )
      mockFile.getMetadata.mockResolvedValueOnce([{ metadata: { 'sim-upload-id': 'receipt-1' } }])

      const result = await completeGcsMultipartUpload(
        '.sim-multipart/receipt-1/workspace/ws-1/large.csv',
        'upload-123',
        [{ PartNumber: 1, ETag: 'etag-1' }]
      )

      expect(mockFile.copy).not.toHaveBeenCalled()
      expect(result.key).toBe('workspace/ws-1/large.csv')
    })

    it('continues the canonical copy when XML completion succeeded before its response was lost', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('<Error/>', { status: 404, statusText: 'Not Found' })
      )
      mockFile.getMetadata
        .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { code: 404 }))
        .mockResolvedValueOnce([{ metadata: { 'sim-upload-id': 'receipt-1' } }])
        .mockResolvedValueOnce([{ metadata: { 'sim-upload-id': 'receipt-1' } }])
      mockFile.copy.mockResolvedValueOnce([mockFile, {}])
      mockFile.delete.mockResolvedValueOnce(undefined)

      const result = await completeGcsMultipartUpload(
        '.sim-multipart/receipt-1/workspace/ws-1/large.csv',
        'upload-123',
        [{ PartNumber: 1, ETag: 'etag-1' }]
      )

      expect(mockFile.copy).toHaveBeenCalledWith(mockFile, {
        preconditionOpts: { ifGenerationMatch: 0 },
      })
      expect(result.key).toBe('workspace/ws-1/large.csv')
    })

    it('fails closed when a different object already occupies the canonical key', async () => {
      mockFetch.mockResolvedValueOnce(new Response('<Complete/>', { status: 200 }))
      mockFile.getMetadata
        .mockResolvedValueOnce([{ metadata: { 'sim-upload-id': 'receipt-1' } }])
        .mockResolvedValueOnce([{ metadata: { 'sim-upload-id': 'different-receipt' } }])
      mockFile.copy.mockRejectedValueOnce(
        Object.assign(new Error('condition failed'), { code: 412 })
      )

      await expect(
        completeGcsMultipartUpload(
          '.sim-multipart/receipt-1/workspace/ws-1/large.csv',
          'upload-123',
          [{ PartNumber: 1, ETag: 'etag-1' }]
        )
      ).rejects.toThrow('condition failed')

      expect(mockFile.delete).not.toHaveBeenCalled()
    })

    it('reuses an existing immutable snapshot only under the explicit policy', async () => {
      mockFetch.mockResolvedValueOnce(new Response('<Complete/>', { status: 200 }))
      mockFile.getMetadata
        .mockResolvedValueOnce([{ metadata: { 'sim-upload-id': 'receipt-1' } }])
        .mockResolvedValueOnce([{ metadata: { 'sim-upload-id': 'other-snapshot-upload' } }])
      mockFile.copy.mockRejectedValueOnce(
        Object.assign(new Error('condition failed'), { code: 412 })
      )

      const result = await completeGcsMultipartUpload(
        '.sim-multipart/receipt-1/table-snapshots/ws-1/table.csv',
        'upload-123',
        [{ PartNumber: 1, ETag: 'etag-1' }],
        undefined,
        'reuse-existing'
      )

      expect(result.key).toBe('table-snapshots/ws-1/table.csv')
      expect(mockFile.delete).toHaveBeenCalledWith({ ignoreNotFound: true })
    })

    it('omits the create precondition for replace-policy exports', async () => {
      mockFetch.mockResolvedValueOnce(new Response('<Complete/>', { status: 200 }))
      mockFile.getMetadata.mockResolvedValueOnce([{ metadata: { 'sim-upload-id': 'receipt-1' } }])
      mockFile.copy.mockResolvedValueOnce([mockFile, {}])

      await completeGcsMultipartUpload(
        '.sim-multipart/receipt-1/workspace/ws-1/export.csv',
        'upload-123',
        [{ PartNumber: 1, ETag: 'etag-1' }],
        undefined,
        'replace'
      )

      expect(mockFile.copy).toHaveBeenCalledWith(mockFile, {})
    })

    it('should restore quotes on ETags stripped by the browser upload client', async () => {
      mockFetch.mockResolvedValueOnce(new Response('<Complete/>', { status: 200 }))

      await completeGcsMultipartUpload('key.csv', 'upload-123', [{ PartNumber: 1, ETag: 'etag-1' }])

      const [, init] = mockFetch.mock.calls[0]
      expect(init.body).toBe(
        '<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>&quot;etag-1&quot;</ETag></Part></CompleteMultipartUpload>'
      )
    })

    it('should abort a multipart upload via DELETE', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))

      await abortGcsMultipartUpload('key.csv', 'upload-123')

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('https://storage.googleapis.com/test-bucket/key.csv?uploadId=upload-123')
      expect(init.method).toBe('DELETE')
    })

    it('should surface abort errors', async () => {
      mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500, statusText: 'ISE' }))

      await expect(abortGcsMultipartUpload('key.csv', 'upload-123')).rejects.toThrow('500 ISE')
    })

    it('should fail multipart calls when no access token is available', async () => {
      mockGetAccessToken.mockResolvedValueOnce(null)

      await expect(
        initiateGcsMultipartUpload({ fileName: 'x.csv', contentType: 'text/csv', fileSize: 1 })
      ).rejects.toThrow('Failed to obtain a Google Cloud access token')
    })
  })
})
