/**
 * Regression tests: Azure Blob storage must be fully usable with ONLY
 * AZURE_CONNECTION_STRING set (no AZURE_ACCOUNT_NAME/AZURE_ACCOUNT_KEY) — this
 * is the connection-string auth mode documented as a standalone alternative
 * across .env.example, helm/sim/values.yaml, and env.ts.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CONNECTION_STRING =
  'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;'

const { mockHeadBlobObject, mockGetBlobServiceClient, mockGenerateBlobSASQueryParameters } =
  vi.hoisted(() => ({
    mockHeadBlobObject: vi.fn(),
    mockGetBlobServiceClient: vi.fn(),
    mockGenerateBlobSASQueryParameters: vi.fn(() => ({ toString: () => 'sig=fake' })),
  }))

vi.mock('@/lib/uploads/config', () => ({
  USE_S3_STORAGE: false,
  USE_BLOB_STORAGE: true,
  // Connection-string-only: accountName/accountKey intentionally absent.
  getStorageConfig: () => ({
    containerName: 'workspace-files',
    accountName: undefined,
    accountKey: undefined,
    connectionString: CONNECTION_STRING,
  }),
}))

vi.mock('@/lib/uploads/providers/blob/client', () => ({
  headBlobObject: mockHeadBlobObject,
  getBlobServiceClient: mockGetBlobServiceClient,
  parseConnectionString: (connectionString: string) => {
    const accountName = connectionString.match(/AccountName=([^;]+)/)?.[1]
    const accountKey = connectionString.match(/AccountKey=([^;]+)/)?.[1]
    if (!accountName || !accountKey) throw new Error('cannot parse')
    return { accountName, accountKey }
  },
}))

vi.mock('@azure/storage-blob', () => ({
  StorageSharedKeyCredential: vi.fn(),
  BlobSASPermissions: { parse: vi.fn(() => 'w') },
  generateBlobSASQueryParameters: mockGenerateBlobSASQueryParameters,
}))

import { generatePresignedUploadUrl, headObject } from '@/lib/uploads/core/storage-service'

describe('Azure Blob storage — connection-string-only auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHeadBlobObject.mockResolvedValue({ size: 42, contentType: 'text/plain' })
    mockGetBlobServiceClient.mockResolvedValue({
      getContainerClient: () => ({
        getBlockBlobClient: () => ({ url: 'https://devstoreaccount1.blob.core.windows.net/c/k' }),
      }),
    })
  })

  it('headObject does not throw when only connectionString is configured', async () => {
    await expect(headObject('some-key', 'workspace')).resolves.toEqual({
      size: 42,
      contentType: 'text/plain',
    })
    expect(mockHeadBlobObject).toHaveBeenCalled()
  })

  it('generatePresignedUploadUrl derives SAS credentials from connectionString when accountName/accountKey are absent', async () => {
    const result = await generatePresignedUploadUrl({
      fileName: 'report.csv',
      contentType: 'text/csv',
      context: 'workspace',
      fileSize: 100,
    })

    expect(mockGenerateBlobSASQueryParameters).toHaveBeenCalled()
    expect(result.url).toContain('sig=fake')
  })
})
