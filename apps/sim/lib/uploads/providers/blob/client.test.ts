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
  deleteFromBlob,
  downloadFromBlob,
  getPresignedUrl,
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
      }

      mockDownload.mockResolvedValueOnce({
        readableStreamBody: mockReadableStream,
      })

      const result = await downloadFromBlob(testKey)

      expect(mockGetBlockBlobClient).toHaveBeenCalledWith(testKey)
      expect(mockDownload).toHaveBeenCalled()
      expect(result).toEqual(testContent)
    })
  })

  describe('deleteFromBlob', () => {
    it('should delete a file from Azure Blob Storage', async () => {
      const testKey = 'test-file-key'

      mockDelete.mockResolvedValueOnce({})

      await deleteFromBlob(testKey)

      expect(mockGetBlockBlobClient).toHaveBeenCalledWith(testKey)
      expect(mockDelete).toHaveBeenCalled()
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
