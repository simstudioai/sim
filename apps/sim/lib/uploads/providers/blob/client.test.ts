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
  mockBeginCopyFromURL,
  mockPollUntilDone,
  mockGetProperties,
  mockGetBlockBlobClient,
  mockGetContainerClient,
  mockFromConnectionString,
  mockStorageSharedKeyCredential,
  mockGenerateBlobSASQueryParameters,
  mockBlobSASPermissionsParse,
} = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockDownload: vi.fn(),
  mockDelete: vi.fn(),
  mockDeleteIfExists: vi.fn(),
  mockBeginCopyFromURL: vi.fn(),
  mockPollUntilDone: vi.fn(),
  mockGetProperties: vi.fn(),
  mockGetBlockBlobClient: vi.fn(),
  mockGetContainerClient: vi.fn(),
  mockFromConnectionString: vi.fn(),
  mockStorageSharedKeyCredential: vi.fn(),
  mockGenerateBlobSASQueryParameters: vi.fn(),
  mockBlobSASPermissionsParse: vi.fn(),
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
  deleteBlobObjectVersion,
  deleteFromBlob,
  downloadFromBlob,
  getBlobPresignedUploadUrl,
  getPresignedUrl,
  headBlobObject,
  parseConnectionString,
  promoteBlobObject,
  uploadToBlob,
} from '@/lib/uploads/providers/blob/client'
import { sanitizeFilenameForMetadata } from '@/lib/uploads/utils/file-utils'

describe('Azure Blob Storage Client', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockBlobSASPermissionsParse.mockReturnValue('r')

    mockGetBlockBlobClient.mockReturnValue({
      upload: mockUpload,
      download: mockDownload,
      delete: mockDelete,
      deleteIfExists: mockDeleteIfExists,
      beginCopyFromURL: mockBeginCopyFromURL,
      getProperties: mockGetProperties,
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
    mockBeginCopyFromURL.mockResolvedValue({ pollUntilDone: mockPollUntilDone })
    mockPollUntilDone.mockResolvedValue({ copyStatus: 'success' })
  })

  describe('uploadToBlob', () => {
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

  describe('staged upload primitives', () => {
    const customConfig = {
      containerName: 'testcontainer',
      accountName: 'testaccount',
      accountKey: 'testkey',
      connectionString:
        'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=testkey;EndpointSuffix=core.windows.net',
    }

    it('signs a PUT with the required blob and metadata headers', async () => {
      mockBlobSASPermissionsParse.mockReturnValueOnce('w')

      const result = await getBlobPresignedUploadUrl({
        key: 'upload-sessions/upload-1/file.bin',
        contentType: 'application/octet-stream',
        metadata: { uploadId: 'upload-1', purpose: 'workspace_file' },
        customConfig,
        expiresIn: 600,
      })

      expect(mockBlobSASPermissionsParse).toHaveBeenCalledWith('w')
      expect(result).toEqual({
        url: expect.stringContaining('?sv=2021-06-08'),
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-ms-blob-type': 'BlockBlob',
          'x-ms-blob-content-type': 'application/octet-stream',
          'x-ms-meta-uploadId': 'upload-1',
          'x-ms-meta-purpose': 'workspace_file',
        },
      })
    })

    it('pins the source ETag and requires an absent promotion destination', async () => {
      await promoteBlobObject({
        sourceKey: 'upload-sessions/upload-1/file.bin',
        destinationKey: 'workspace/workspace-1/file.bin',
        sourceEtag: '"etag-1"',
        customConfig,
      })

      expect(mockBeginCopyFromURL).toHaveBeenCalledWith(
        'https://test.blob.core.windows.net/container/test-file',
        {
          conditions: { ifNoneMatch: '*' },
          sourceConditions: { ifMatch: '"etag-1"' },
        }
      )
      expect(mockPollUntilDone).toHaveBeenCalledOnce()
    })

    it('returns only completed copied objects as usable upload identities', async () => {
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
        }
      )

      mockGetProperties.mockResolvedValueOnce({ copyStatus: 'pending' })
      await expect(headBlobObject('workspace/workspace-1/file.bin', customConfig)).rejects.toThrow(
        'Blob copy for workspace/workspace-1/file.bin is pending'
      )
    })

    it('deletes staging only when its ETag still matches', async () => {
      mockDeleteIfExists.mockResolvedValueOnce({})

      await deleteBlobObjectVersion({
        key: 'upload-sessions/upload-1/file.bin',
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
      await abortMultipartUpload('test-file-key')

      expect(mockGetBlockBlobClient).not.toHaveBeenCalled()
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
