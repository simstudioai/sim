/**
 * Regression tests: Azure Blob storage must be fully usable with ONLY
 * AZURE_CONNECTION_STRING set (no AZURE_ACCOUNT_NAME/AZURE_ACCOUNT_KEY) — this
 * is the connection-string auth mode documented as a standalone alternative
 * across .env.example, helm/sim/values.yaml, and env.ts.
 *
 * @vitest-environment node
 *
 * Under `isolate: false` the storage-service module may already be cached from
 * another test file, bound to the real `@/lib/uploads/config` namespace, so a
 * per-file `vi.mock` of that path would never reach it. Instead this file
 * patches the real config namespace in place (the `USE_*` flags are value
 * exports read at call time) and restores it afterwards. The blob client and
 * Azure SDK are pulled in via dynamic `import()` at call time, so regular
 * `vi.mock` registrations still apply to them.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as uploadsConfig from '@/lib/uploads/config'
import { generatePresignedUploadUrl, headObject } from '@/lib/uploads/core/storage-service'

const CONNECTION_STRING =
  'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;'

const { mockHeadBlobObject, mockGetBlobServiceClient, mockGenerateBlobSASQueryParameters } =
  vi.hoisted(() => ({
    mockHeadBlobObject: vi.fn(),
    mockGetBlobServiceClient: vi.fn(),
    mockGenerateBlobSASQueryParameters: vi.fn(() => ({ toString: () => 'sig=fake' })),
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

const STORAGE_FLAGS = ['USE_S3_STORAGE', 'USE_BLOB_STORAGE', 'USE_GCS_STORAGE'] as const

const originalFlagValues = STORAGE_FLAGS.map(
  (flag) => [flag, uploadsConfig[flag]] as [string, boolean]
)

function setFlag(flag: (typeof STORAGE_FLAGS)[number], value: boolean): void {
  Object.defineProperty(uploadsConfig, flag, { value, configurable: true })
}

setFlag('USE_S3_STORAGE', false)
setFlag('USE_BLOB_STORAGE', true)
setFlag('USE_GCS_STORAGE', false)

const getStorageConfigSpy = vi
  .spyOn(uploadsConfig, 'getStorageConfig')
  // Connection-string-only: accountName/accountKey intentionally absent.
  .mockReturnValue({
    containerName: 'workspace-files',
    accountName: undefined,
    accountKey: undefined,
    connectionString: CONNECTION_STRING,
  })

afterAll(() => {
  for (const [flag, value] of originalFlagValues) {
    Object.defineProperty(uploadsConfig, flag, { value, configurable: true })
  }
  getStorageConfigSpy.mockRestore()
})

describe('Azure Blob storage — connection-string-only auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getStorageConfigSpy.mockReturnValue({
      containerName: 'workspace-files',
      accountName: undefined,
      accountKey: undefined,
      connectionString: CONNECTION_STRING,
    })
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
