/**
 * Tests for Azure Blob Storage client
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockUpload,
  mockDownload,
  mockDelete,
  mockDeleteIfExists,
  mockGetBlockList,
  mockGetProperties,
  mockGetBlockBlobClient,
  mockGetContainerClient,
  mockFromConnectionString,
  mockStorageSharedKeyCredential,
  mockGenerateBlobSASQueryParameters,
  mockBlobSASPermissionsParse,
  mockCommitBlockList,
  mockSetMetadata,
} = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockDownload: vi.fn(),
  mockDelete: vi.fn(),
  mockDeleteIfExists: vi.fn(),
  mockGetBlockList: vi.fn(),
  mockGetProperties: vi.fn(),
  mockGetBlockBlobClient: vi.fn(),
  mockGetContainerClient: vi.fn(),
  mockFromConnectionString: vi.fn(),
  mockStorageSharedKeyCredential: vi.fn(),
  mockGenerateBlobSASQueryParameters: vi.fn(),
  mockBlobSASPermissionsParse: vi.fn(),
  mockCommitBlockList: vi.fn(),
  mockSetMetadata: vi.fn(),
}))

vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: {
    fromConnectionString: mockFromConnectionString,
  },
  StorageSharedKeyCredential: mockStorageSharedKeyCredential,
  generateBlobSASQueryParameters: mockGenerateBlobSASQueryParameters,
  BlobSASPermissions: {
    parse: mockBlobSASPermissionsParse,
  },
}))

vi.mock('@/lib/uploads/config', () => ({
  BLOB_CONFIG: {
    accountName: 'testaccount',
    accountKey: 'testkey',
    connectionString:
      'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=testkey;EndpointSuffix=core.windows.net',
    containerName: 'testcontainer',
  },
}))

import {
  abortMultipartUpload,
  commitBlobBlockList,
  completeMultipartUpload,
  deleteBlobObjectVersion,
  deleteFromBlob,
  downloadFromBlob,
  getBlobPresignedUploadUrl,
  getMultipartPartUrls,
  getPresignedUrl,
  headBlobObject,
  initiateMultipartUpload,
  listMultipartParts,
  parseConnectionString,
  uploadToBlob,
} from '@/lib/uploads/providers/blob/client'
import { sanitizeFilenameForMetadata } from '@/lib/uploads/utils/file-utils'

describe('Azure Blob Storage Client', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockBlobSASPermissionsParse.mockReturnValue('r')

    mockGetBlockBlobClient.mockReturnValue({
      commitBlockList: mockCommitBlockList,
      upload: mockUpload,
      download: mockDownload,
      delete: mockDelete,
      deleteIfExists: mockDeleteIfExists,
      getBlockList: mockGetBlockList,
      getProperties: mockGetProperties,
      setMetadata: mockSetMetadata,
      url: 'https://test.blob.core.windows.net/container/test-file',
    })

    mockGetContainerClient.mockReturnValue({
      getBlockBlobClient: mockGetBlockBlobClient,
    })

    mockFromConnectionString.mockReturnValue({
      getContainerClient: mockGetContainerClient,
    })

    mockGenerateBlobSASQueryParameters.mockReturnValue({
      toString: () => 'sv=2021-06-08&se=2023-01-01T00%3A00%3A00Z&sr=b&sp=r&sig=test',
    })
  })

  describe('uploadToBlob', () => {
    it.each(['upload', 'delete'] as const)(
      'cancels a stalled %s through the SDK signal',
      async (operation) => {
        const controller = new AbortController()
        const aborted = new Error('Checkpoint expired')
        let started!: () => void
        const ready = new Promise<void>((resolve) => {
          started = resolve
        })
        const waitForAbort = (options: { abortSignal: AbortSignal }) => {
          started()
          return new Promise((_resolve, reject) => {
            options.abortSignal.addEventListener(
              'abort',
              () => reject(options.abortSignal.reason),
              { once: true }
            )
          })
        }
        if (operation === 'upload') {
          mockUpload.mockImplementationOnce((_file, _size, options) => waitForAbort(options))
        } else {
          mockDeleteIfExists.mockImplementationOnce(waitForAbort)
        }
        const pending =
          operation === 'upload'
            ? uploadToBlob(
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
            : deleteFromBlob('checkpoint.txt', undefined, controller.signal)
        const result = expect(pending).rejects.toBe(aborted)
        await ready
        controller.abort(aborted)
        await result
      }
    )

    it('refuses an already canceled upload before dispatching it', async () => {
      const controller = new AbortController()
      controller.abort()
      await expect(
        uploadToBlob(
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
      ).rejects.toHaveProperty('name', 'AbortError')
      expect(mockUpload).not.toHaveBeenCalled()
    })

    it('adds an if-none-match precondition for an immutable upload', async () => {
      mockUpload.mockResolvedValueOnce({})

      await uploadToBlob(
        Buffer.from('new'),
        'kb/new.txt',
        'text/plain',
        undefined,
        undefined,
        true,
        { uploadId: 'attempt-1' },
        true
      )

      expect(mockUpload).toHaveBeenCalledWith(
        Buffer.from('new'),
        3,
        expect.objectContaining({
          conditions: { ifNoneMatch: '*' },
          metadata: expect.objectContaining({ uploadId: 'attempt-1' }),
        })
      )
    })

    it('should upload a file to Azure Blob Storage', async () => {
      const testBuffer = Buffer.from('test file content')
      const fileName = 'test-file.txt'
      const contentType = 'text/plain'

      mockUpload.mockResolvedValueOnce({})

      const result = await uploadToBlob(testBuffer, fileName, contentType)

      expect(mockUpload).toHaveBeenCalledWith(testBuffer, testBuffer.length, {
        blobHTTPHeaders: {
          blobContentType: contentType,
        },
        metadata: {
          originalName: encodeURIComponent(fileName),
          uploadedAt: expect.any(String),
        },
      })

      expect(result).toEqual({
        path: expect.stringContaining('/api/files/serve/'),
        key: expect.stringContaining(fileName.replace(/\s+/g, '-')),
        name: fileName,
        size: testBuffer.length,
        type: contentType,
      })
    })

    it('should handle custom blob configuration', async () => {
      const testBuffer = Buffer.from('test file content')
      const fileName = 'test-file.txt'
      const contentType = 'text/plain'
      const customConfig = {
        containerName: 'customcontainer',
        accountName: 'customaccount',
        accountKey: 'customkey',
      }

      mockUpload.mockResolvedValueOnce({})

      const result = await uploadToBlob(testBuffer, fileName, contentType, customConfig)

      expect(mockGetContainerClient).toHaveBeenCalledWith('customcontainer')
      expect(result.name).toBe(fileName)
      expect(result.type).toBe(contentType)
    })
  })

  describe('direct upload primitives', () => {
    const customConfig = {
      containerName: 'testcontainer',
      accountName: 'testaccount',
      accountKey: 'testkey',
      connectionString:
        'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=testkey;EndpointSuffix=core.windows.net',
    }

    it('signs a create-only PUT with the required blob and metadata headers', async () => {
      mockBlobSASPermissionsParse.mockReturnValueOnce('c')

      const result = await getBlobPresignedUploadUrl({
        key: 'workspace/workspace-1/file.bin',
        contentType: 'application/octet-stream',
        metadata: { uploadId: 'upload-1', purpose: 'workspace_file' },
        customConfig,
        expiresIn: 600,
      })

      expect(mockBlobSASPermissionsParse).toHaveBeenCalledWith('c')
      expect(result).toEqual({
        url: expect.stringContaining('?sv=2021-06-08'),
        headers: {
          'Content-Type': 'application/octet-stream',
          'If-None-Match': '*',
          'x-ms-blob-type': 'BlockBlob',
          'x-ms-blob-content-type': 'application/octet-stream',
          'x-ms-meta-uploadId': 'upload-1',
          'x-ms-meta-purpose': 'workspace_file',
        },
      })
    })

    it('signs multipart part URLs to the lifetime the caller passed', async () => {
      const expiresOn = new Date('2026-01-01T00:02:00.000Z')

      await getMultipartPartUrls('workspace/workspace-1/file.bin', [1], customConfig, expiresOn)

      // The caller owns the lifetime and advertises the matching `expiresAt`; a window this
      // function picks for itself is how the advertised expiry and the real SAS token drift.
      expect(mockGenerateBlobSASQueryParameters).toHaveBeenCalledWith(
        expect.objectContaining({ expiresOn }),
        expect.anything()
      )
    })

    it('returns only completed objects as usable upload identities', async () => {
      mockGetProperties.mockResolvedValueOnce({
        contentLength: 3,
        contentType: 'application/octet-stream',
        metadata: { uploadid: 'upload-1' },
        etag: '"etag-1"',
        copyStatus: 'success',
      })

      await expect(headBlobObject('workspace/workspace-1/file.bin', customConfig)).resolves.toEqual(
        {
          size: 3,
          contentType: 'application/octet-stream',
          uploadId: 'upload-1',
          version: '"etag-1"',
          metadata: { uploadid: 'upload-1' },
        }
      )

      mockGetProperties.mockResolvedValueOnce({ copyStatus: 'pending' })
      await expect(headBlobObject('workspace/workspace-1/file.bin', customConfig)).rejects.toThrow(
        'Blob copy for workspace/workspace-1/file.bin is pending'
      )
    })

    it('lists provider-authoritative uncommitted blocks', async () => {
      mockGetBlockList.mockResolvedValueOnce({
        uncommittedBlocks: [
          { name: Buffer.from('block-000001').toString('base64'), size: 8 },
          { name: Buffer.from('block-000002').toString('base64'), size: 3 },
        ],
      })

      await expect(
        listMultipartParts('workspace/workspace-1/file.bin', customConfig)
      ).resolves.toEqual([
        { partNumber: 1, size: 8 },
        { partNumber: 2, size: 3 },
      ])
      expect(mockGetBlockList).toHaveBeenCalledWith('uncommitted')
    })

    it('deletes the upload object only when its ETag still matches', async () => {
      mockDeleteIfExists.mockResolvedValueOnce({})

      await deleteBlobObjectVersion({
        key: 'workspace/workspace-1/file.bin',
        etag: '"etag-1"',
        customConfig,
      })

      expect(mockDeleteIfExists).toHaveBeenCalledWith({ conditions: { ifMatch: '"etag-1"' } })
    })
  })

  describe('downloadFromBlob', () => {
    it('should download a file from Azure Blob Storage', async () => {
      const testKey = 'test-file-key'
      const testContent = Buffer.from('downloaded content')

      const mockReadableStream = {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback(testContent)
          } else if (event === 'end') {
            callback()
          }
        }),
        off: vi.fn(() => mockReadableStream),
      }

      mockDownload.mockResolvedValueOnce({
        readableStreamBody: mockReadableStream,
      })

      const result = await downloadFromBlob(testKey)

      expect(mockGetBlockBlobClient).toHaveBeenCalledWith(testKey)
      expect(mockDownload).toHaveBeenCalled()
      expect(result).toEqual(testContent)
    })

    it('should destroy the opened stream when content length exceeds the limit', async () => {
      const mockDestroy = vi.fn()
      const mockReadableStream = {
        destroy: mockDestroy,
        on: vi.fn(() => mockReadableStream),
      }

      mockDownload.mockResolvedValueOnce({
        readableStreamBody: mockReadableStream,
        contentLength: 1024,
      })

      await expect(downloadFromBlob('large-file-key', undefined, 10)).rejects.toThrow(
        'storage download exceeds maximum size'
      )
      expect(mockDestroy).toHaveBeenCalledWith(expect.any(Error))
    })

    it('forwards cancellation to Azure and destroys the response stream', async () => {
      const controller = new AbortController()
      const mockDestroy = vi.fn()
      const mockReadableStream = {
        destroy: mockDestroy,
        on: vi.fn(() => mockReadableStream),
        off: vi.fn(() => mockReadableStream),
      }
      mockDownload.mockResolvedValueOnce({ readableStreamBody: mockReadableStream })

      const download = downloadFromBlob('test-file-key', undefined, undefined, controller.signal)
      await vi.waitFor(() => expect(mockReadableStream.on).toHaveBeenCalled())
      controller.abort(new Error('cancelled'))

      await expect(download).rejects.toThrow('cancelled')
      expect(mockDownload).toHaveBeenCalledWith(
        0,
        undefined,
        expect.objectContaining({ abortSignal: controller.signal })
      )
      expect(mockDestroy).toHaveBeenCalledWith()
    })
  })

  describe('headBlobObject', () => {
    it('returns custom metadata used for direct-upload receipt verification', async () => {
      mockGetProperties.mockResolvedValueOnce({
        contentLength: 12,
        contentType: 'text/plain',
        metadata: { simuploadid: 'receipt-1' },
      })

      await expect(headBlobObject('workspace/file.txt')).resolves.toEqual({
        size: 12,
        contentType: 'text/plain',
        metadata: { simuploadid: 'receipt-1' },
      })
    })

    it('reports an absent blob as null rather than raising', async () => {
      /** Azure names the class in `name` and the reason in `code`. */
      mockGetProperties.mockRejectedValueOnce(
        Object.assign(new Error('BlobNotFound'), {
          name: 'RestError',
          code: 'BlobNotFound',
          statusCode: 404,
        })
      )

      await expect(headBlobObject('workspace/superseded.md')).resolves.toBeNull()
    })

    it('raises when the container itself is missing', async () => {
      /** Also a 404, but a misconfiguration — reporting absence would hide an outage. */
      mockGetProperties.mockRejectedValueOnce(
        Object.assign(new Error('ContainerNotFound'), {
          name: 'RestError',
          code: 'ContainerNotFound',
          statusCode: 404,
        })
      )

      await expect(headBlobObject('workspace/file.txt')).rejects.toThrow('ContainerNotFound')
    })

    it('raises on a permission failure', async () => {
      mockGetProperties.mockRejectedValueOnce(
        Object.assign(new Error('AuthorizationFailure'), {
          name: 'RestError',
          code: 'AuthorizationFailure',
          statusCode: 403,
        })
      )

      await expect(headBlobObject('workspace/file.txt')).rejects.toThrow('AuthorizationFailure')
    })
  })

  describe('deleteFromBlob', () => {
    it('should delete a file from Azure Blob Storage', async () => {
      const testKey = 'test-file-key'

      mockDeleteIfExists.mockResolvedValueOnce({})

      await deleteFromBlob(testKey)

      expect(mockGetBlockBlobClient).toHaveBeenCalledWith(testKey)
      expect(mockDeleteIfExists).toHaveBeenCalled()
    })
  })

  describe('abortMultipartUpload', () => {
    it('leaves the blob key untouched while Azure garbage-collects uncommitted blocks', async () => {
      await abortMultipartUpload('test-file-key', 'upload-1')

      expect(mockGetBlockBlobClient).toHaveBeenCalledWith('test-file-key')
      expect(mockDeleteIfExists).not.toHaveBeenCalled()
    })
  })

  describe('getPresignedUrl', () => {
    it('should generate a presigned URL for Azure Blob Storage', async () => {
      const testKey = 'test-file-key'
      const expiresIn = 3600

      const result = await getPresignedUrl(testKey, expiresIn)

      expect(mockGetBlockBlobClient).toHaveBeenCalledWith(testKey)
      expect(mockGenerateBlobSASQueryParameters).toHaveBeenCalled()
      expect(result).toContain('https://test.blob.core.windows.net/container/test-file')
      expect(result).toContain('sv=2021-06-08')
    })
  })

  describe('multipart uploads', () => {
    it('does not create the canonical blob when initiating an upload', async () => {
      const result = await initiateMultipartUpload({
        fileName: 'large.bin',
        contentType: 'application/octet-stream',
        fileSize: 10,
        customKey: 'workspace/ws-1/large.bin',
      })

      expect(result.key).toBe('workspace/ws-1/large.bin')
      expect(mockSetMetadata).not.toHaveBeenCalled()
    })

    it('commits multipart blocks only when the canonical blob does not exist', async () => {
      mockCommitBlockList.mockResolvedValueOnce(undefined)

      await completeMultipartUpload('workspace/ws-1/large.bin', 'upload-1', [
        { partNumber: 2, blockId: 'block-2' },
        { partNumber: 1, blockId: 'block-1' },
      ])

      expect(mockCommitBlockList).toHaveBeenCalledWith(['block-1', 'block-2'], {
        conditions: { ifNoneMatch: '*' },
        metadata: {
          sim_multipart_status: 'completed',
          sim_upload_id: 'upload-1',
          uploadCompletedAt: expect.any(String),
        },
      })
    })

    it('returns the immutable blob when a successful commit response was lost', async () => {
      mockCommitBlockList.mockRejectedValueOnce(new Error('ConditionNotMet'))
      mockGetProperties.mockResolvedValueOnce({
        contentLength: 10,
        contentType: 'application/octet-stream',
        metadata: { sim_upload_id: 'upload-1', sim_multipart_status: 'completed' },
      })

      const result = await completeMultipartUpload('workspace/ws-1/large.bin', 'upload-1', [
        { partNumber: 1, blockId: 'block-1' },
      ])

      expect(mockGetProperties).toHaveBeenCalled()
      expect(result.key).toBe('workspace/ws-1/large.bin')
    })

    it('finishes a matching legacy pending placeholder without opening unrelated overwrite', async () => {
      mockCommitBlockList
        .mockRejectedValueOnce(
          Object.assign(new Error('ConditionNotMet'), { code: 'ConditionNotMet' })
        )
        .mockResolvedValueOnce(undefined)
      mockGetProperties.mockResolvedValueOnce({
        etag: 'legacy-etag',
        metadata: { uploadid: 'upload-1', multipartupload: 'true' },
      })

      await completeMultipartUpload('workspace/ws-1/large.bin', 'upload-1', [
        { partNumber: 1, blockId: 'block-1' },
      ])

      expect(mockCommitBlockList).toHaveBeenNthCalledWith(2, ['block-1'], {
        conditions: { ifMatch: 'legacy-etag' },
        metadata: {
          sim_multipart_status: 'completed',
          sim_upload_id: 'upload-1',
          uploadCompletedAt: expect.any(String),
        },
      })
    })

    it('fails closed when a different upload already owns the canonical blob', async () => {
      mockCommitBlockList.mockRejectedValueOnce(new Error('ConditionNotMet'))
      mockGetProperties.mockResolvedValueOnce({
        metadata: { sim_upload_id: 'different-upload', sim_multipart_status: 'completed' },
      })

      await expect(
        completeMultipartUpload('workspace/ws-1/large.bin', 'upload-1', [
          { partNumber: 1, blockId: 'block-1' },
        ])
      ).rejects.toThrow('ConditionNotMet')
    })

    it('never deletes a completed blob while aborting a retried request', async () => {
      mockGetProperties.mockResolvedValueOnce({
        metadata: { sim_upload_id: 'upload-1', sim_multipart_status: 'completed' },
      })

      await abortMultipartUpload('workspace/ws-1/large.bin', 'upload-1')

      expect(mockDeleteIfExists).not.toHaveBeenCalled()
    })

    it('cleans up only a matching legacy pending placeholder', async () => {
      mockGetProperties.mockResolvedValueOnce({
        metadata: { uploadid: 'upload-1', multipartupload: 'true' },
      })

      await abortMultipartUpload('workspace/ws-1/large.bin', 'upload-1')

      expect(mockDeleteIfExists).toHaveBeenCalledTimes(1)
    })

    it('retains replace semantics for deterministic internal exports', async () => {
      mockCommitBlockList.mockResolvedValueOnce(undefined)

      await commitBlobBlockList(
        'workspace/ws-1/export.csv',
        'upload-1',
        [{ partNumber: 1, blockId: 'block-1' }],
        'text/csv',
        undefined,
        'replace'
      )

      expect(mockCommitBlockList).toHaveBeenCalledWith(
        ['block-1'],
        expect.not.objectContaining({ conditions: { ifNoneMatch: '*' } })
      )
    })

    it('reuses an existing snapshot only under the explicit policy', async () => {
      mockCommitBlockList.mockRejectedValueOnce(
        Object.assign(new Error('ConditionNotMet'), { code: 'ConditionNotMet' })
      )
      mockGetProperties.mockResolvedValueOnce({
        metadata: { sim_upload_id: 'different-upload' },
      })

      await expect(
        commitBlobBlockList(
          'table-snapshots/ws-1/table.csv',
          'upload-1',
          [{ partNumber: 1, blockId: 'block-1' }],
          'text/csv',
          undefined,
          'reuse-existing'
        )
      ).resolves.toBeUndefined()
    })
  })

  describe('parseConnectionString', () => {
    it('extracts accountName and accountKey from a well-formed connection string', () => {
      const result = parseConnectionString(
        'DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=mykey123;EndpointSuffix=core.windows.net'
      )
      expect(result).toEqual({ accountName: 'myaccount', accountKey: 'mykey123' })
    })

    it('throws when AccountName is missing', () => {
      expect(() =>
        parseConnectionString('DefaultEndpointsProtocol=https;AccountKey=mykey123')
      ).toThrow('Cannot extract account name from connection string')
    })

    it('throws when AccountKey is missing', () => {
      expect(() =>
        parseConnectionString('DefaultEndpointsProtocol=https;AccountName=myaccount')
      ).toThrow('Cannot extract account key from connection string')
    })
  })

  describe('sanitizeFilenameForMetadata', () => {
    const testCases = [
      { input: 'test file.txt', expected: 'test file.txt' },
      { input: 'test"file.txt', expected: 'testfile.txt' },
      { input: 'test\\file.txt', expected: 'testfile.txt' },
      { input: 'test  file.txt', expected: 'test file.txt' },
      { input: '', expected: 'file' },
    ]

    it.each(testCases)('should sanitize "$input" to "$expected"', ({ input, expected }) => {
      expect(sanitizeFilenameForMetadata(input)).toBe(expected)
    })
  })
})
