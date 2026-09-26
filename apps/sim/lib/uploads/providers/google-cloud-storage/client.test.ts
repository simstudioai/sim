/**
 * Tests for GCS client functionality
 */
import { Writable } from 'node:stream'
import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { setUploadsConfig, uploadsConfigMock } from '@sim/testing/mocks/uploads-config.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFile,
  mockBucket,
  mockStorageInstance,
  mockStorageConstructor,
  mockGetAccessToken,
  mockGcsConfig,
} = vi.hoisted(() => {
  const mockFile = {
    save: vi.fn(),
    createWriteStream: vi.fn(),
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
    authClient: { getAccessToken: mockGetAccessToken, request: vi.fn() },
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
    mockGcsConfig,
  }
})

vi.mock('@google-cloud/storage', () => ({
  Storage: mockStorageConstructor,
}))

vi.mock('@/lib/uploads/config', () => uploadsConfigMock)

import {
  completeGcsMultipartUpload,
  deleteFromGcs,
  deleteGcsObjectVersion,
  downloadFromGcs,
  getGcsClient,
  getGcsPresignedUploadUrl,
  initiateGcsMultipartUpload,
  listGcsMultipartParts,
  resetGcsClientForTesting,
  uploadGcsPart,
  uploadToGcs,
} from '@/lib/uploads/providers/google-cloud-storage/client'

setUploadsConfig({ GCS_CONFIG: mockGcsConfig })

setEnv({
  GCS_BUCKET_NAME: 'test-bucket',
})
afterAll(resetEnvMock)

const mockFetch = vi.fn()

describe('GCS Client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    setEnv({ GCS_PROJECT_ID: undefined })
    setEnv({ GCS_CREDENTIALS_JSON: undefined })
    mockGetAccessToken.mockResolvedValue('test-access-token')
    resetGcsClientForTesting()
  })

  describe('getGcsClient', () => {
    it('should reject invalid credentials JSON', async () => {
      setEnv({ GCS_CREDENTIALS_JSON: 'not-json' })

      await expect(getGcsClient()).rejects.toThrow('GCS_CREDENTIALS_JSON is not valid JSON')
    })
  })

  describe('uploadToGcs', () => {
    it('destroys a stalled upload stream when its caller cancels', async () => {
      const controller = new AbortController()
      let started!: () => void
      const ready = new Promise<void>((resolve) => {
        started = resolve
      })
      const destination = new Writable({
        write() {
          started()
        },
      })
      mockFile.createWriteStream.mockReturnValueOnce(destination)
      const pending = uploadToGcs(
        Buffer.from('private text'),
        'checkpoint.txt',
        'text/plain',
        undefined,
        undefined,
        true,
        undefined,
        false,
        controller.signal
      )
      const result = expect(pending).rejects.toHaveProperty('name', 'AbortError')
      await ready
      controller.abort()
      await result
      expect(destination.destroyed).toBe(true)
      expect(mockFile.save).not.toHaveBeenCalled()
      expect(mockFile.createWriteStream).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 30_000, resumable: false })
      )
    })

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
  })

  describe('presigned URLs', () => {
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
    it('should reject before streaming when the known size exceeds the limit', async () => {
      mockFile.getMetadata.mockResolvedValueOnce([{ size: '1024' }])

      await expect(downloadFromGcs('big.bin', { bucket: 'test-bucket' }, 10)).rejects.toThrow(
        'storage download exceeds maximum size'
      )
      expect(mockFile.createReadStream).not.toHaveBeenCalled()
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
    it('cancels deletion through the existing SDK credentials and treats missing objects as deleted', async () => {
      const controller = new AbortController()
      let started!: () => void
      const ready = new Promise<void>((resolve) => {
        started = resolve
      })
      mockStorageInstance.authClient.request.mockImplementationOnce(
        (options: { signal: AbortSignal }) => {
          started()
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), {
              once: true,
            })
          })
        }
      )
      const pending = deleteFromGcs(
        'checkpoint/private.txt',
        { bucket: 'private-bucket' },
        controller.signal
      )
      const result = expect(pending).rejects.toHaveProperty('name', 'AbortError')
      await ready
      controller.abort()
      await result
      const options = mockStorageInstance.authClient.request.mock.calls[0][0]
      expect(options.url).toBe(
        'https://storage.googleapis.com/storage/v1/b/private-bucket/o/checkpoint%2Fprivate.txt'
      )
      expect(options.method).toBe('DELETE')
      expect(options.validateStatus(204)).toBe(true)
      expect(options.validateStatus(404)).toBe(true)
      expect(options.validateStatus(403)).toBe(false)
      expect(mockFile.delete).not.toHaveBeenCalled()
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

    it('should throw when the initiate response has no UploadId', async () => {
      mockFetch.mockResolvedValueOnce(new Response('<Empty/>', { status: 200 }))

      await expect(
        initiateGcsMultipartUpload({ fileName: 'x.csv', contentType: 'text/csv', fileSize: 1 })
      ).rejects.toThrow('no UploadId in response')
    })

    it('should throw when a part upload returns no ETag', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

      await expect(uploadGcsPart('key.csv', 'upload-123', 1, Buffer.from('data'))).rejects.toThrow(
        'no ETag'
      )
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
  })
})
