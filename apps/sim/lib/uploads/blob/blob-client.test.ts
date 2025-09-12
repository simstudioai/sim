/**
 * Tests for Azure Blob Storage client
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUpload = vi.fn()
const mockDownload = vi.fn()
const mockDelete = vi.fn()
const mockGetBlockBlobClient = vi.fn()
const mockGetContainerClient = vi.fn()
const mockFromConnectionString = vi.fn()
const mockBlobServiceClient = vi.fn()
const mockStorageSharedKeyCredential = vi.fn()
const mockGenerateBlobSASQueryParameters = vi.fn()

vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: {
    fromConnectionString: mockFromConnectionString,
  },
  StorageSharedKeyCredential: mockStorageSharedKeyCredential,
  generateBlobSASQueryParameters: mockGenerateBlobSASQueryParameters,
  BlobSASPermissions: {
    parse: vi.fn().mockReturnValue('r'),
  },
}))

describe('Azure Blob Storage Client', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

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

    mockBlobServiceClient.mockReturnValue({
      getContainerClient: mockGetContainerClient,
    })

    mockGenerateBlobSASQueryParameters.mockReturnValue({
      toString: () => 'sv=2021-06-08&se=2023-01-01T00%3A00%3A00Z&sr=b&sp=r&sig=test',
    })

    vi.doMock('@/lib/env', () => ({
      env: {
        AZURE_ACCOUNT_NAME: 'testaccount',
        AZURE_ACCOUNT_KEY: 'testkey',
        AZURE_CONNECTION_STRING:
          'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=testkey;EndpointSuffix=core.windows.net',
        AZURE_STORAGE_CONTAINER_NAME: 'testcontainer',
      },
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    }))

    vi.doMock('@/lib/uploads/setup', () => ({
      BLOB_CONFIG: {
        accountName: 'testaccount',
        accountKey: 'testkey',
        connectionString:
          'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=testkey;EndpointSuffix=core.windows.net',
        containerName: 'testcontainer',
      },
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('uploadToBlob', () => {
    it('should upload a file to Azure Blob Storage', async () => {
      const { uploadToBlob } = await import('@/lib/uploads/blob/blob-client')

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
        path: expect.stringContaining('/api/files/serve/blob/'),
        key: expect.stringContaining(fileName.replace(/\s+/g, '-')),
        name: fileName,
        size: testBuffer.length,
        type: contentType,
      })
    })

    it('should handle custom blob configuration', async () => {
      const { uploadToBlob } = await import('@/lib/uploads/blob/blob-client')

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
      const { downloadFromBlob } = await import('@/lib/uploads/blob/blob-client')

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
      const { deleteFromBlob } = await import('@/lib/uploads/blob/blob-client')

      const testKey = 'test-file-key'

      mockDelete.mockResolvedValueOnce({})

      await deleteFromBlob(testKey)

      expect(mockGetBlockBlobClient).toHaveBeenCalledWith(testKey)
      expect(mockDelete).toHaveBeenCalled()
    })
  })

  describe('getPresignedUrl', () => {
    it('should generate a presigned URL for Azure Blob Storage', async () => {
      const { getPresignedUrl } = await import('@/lib/uploads/blob/blob-client')

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

    it.each(testCases)('should sanitize "$input" to "$expected"', async ({ input, expected }) => {
      const { sanitizeFilenameForMetadata } = await import('@/lib/uploads/blob/blob-client')
      expect(sanitizeFilenameForMetadata(input)).toBe(expected)
    })
  })
})
