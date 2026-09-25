/**
 * Tests for Azure Blob Storage client
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
  downloadFromBlob,
  getBlobPresignedUploadUrl,
  headBlobObject,
  parseConnectionString,
  uploadToBlob,
} from '@/lib/uploads/providers/blob/client'
import { sanitizeFilenameForMetadata } from '@/lib/uploads/utils/file-utils'

describe('Azure Blob Storage Client', () => {
  beforeEach(() => {
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

  describe('headBlobObject', () => {
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
  })

  describe('multipart uploads', () => {
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
    it('throws when AccountName is missing', () => {
      expect(() =>
        parseConnectionString('DefaultEndpointsProtocol=https;AccountKey=mykey123')
      ).toThrow('Cannot extract account name from connection string')
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
