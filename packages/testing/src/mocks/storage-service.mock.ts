import { vi } from 'vitest'

/** Structural stand-in for `StorageConfig` from `@/lib/uploads/shared/types`. */
interface MockStorageConfig {
  bucket?: string
  region?: string
  containerName?: string
  accountName?: string
  accountKey?: string
  connectionString?: string
}

/**
 * Controllable mock functions for `@/lib/uploads/core/storage-service`.
 *
 * I/O functions are bare `vi.fn()`s — configure per test. `hasCloudStorage` defaults
 * to `false`; the three `create*Config` builders are faithful ports (they validate and
 * project a config, no I/O).
 *
 * @example
 * ```ts
 * import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
 *
 * storageServiceMockFns.mockHasCloudStorage.mockReturnValue(true)
 * storageServiceMockFns.mockDownloadFile.mockResolvedValue(Buffer.from('bytes'))
 * ```
 */
export const storageServiceMockFns = {
  mockUploadFile: vi.fn(),
  mockCreateMultipartUpload: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockDownloadFileStream: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockDeleteFiles: vi.fn(),
  mockHeadObject: vi.fn(),
  mockGeneratePresignedDownloadUrl: vi.fn(),
  mockHasCloudStorage: vi.fn(() => false),
  mockGetS3InfoForKey: vi.fn(),
  mockCreateBlobConfig: vi.fn((config: MockStorageConfig) => {
    if (!config.containerName) {
      throw new Error('Blob configuration missing required property: containerName')
    }
    if (!config.connectionString && !(config.accountName && config.accountKey)) {
      throw new Error(
        'Blob configuration missing authentication: either connectionString or both accountName and accountKey must be provided'
      )
    }
    return {
      containerName: config.containerName,
      accountName: config.accountName,
      accountKey: config.accountKey,
      connectionString: config.connectionString,
    }
  }),
  mockCreateS3Config: vi.fn((config: MockStorageConfig) => {
    if (!config.bucket || !config.region) {
      throw new Error('S3 configuration missing required properties: bucket and region')
    }
    return { bucket: config.bucket, region: config.region }
  }),
  mockCreateGcsConfig: vi.fn((config: MockStorageConfig) => {
    if (!config.bucket) {
      throw new Error('GCS configuration missing required property: bucket')
    }
    return { bucket: config.bucket }
  }),
}

/**
 * Static mock module for `@/lib/uploads/core/storage-service`.
 * Also the `StorageService` namespace of `uploadsMock` (`@/lib/uploads`), so both
 * import paths drive the same `vi.fn()`s.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
 * ```
 */
export const storageServiceMock = {
  uploadFile: storageServiceMockFns.mockUploadFile,
  createMultipartUpload: storageServiceMockFns.mockCreateMultipartUpload,
  downloadFile: storageServiceMockFns.mockDownloadFile,
  downloadFileStream: storageServiceMockFns.mockDownloadFileStream,
  deleteFile: storageServiceMockFns.mockDeleteFile,
  deleteFiles: storageServiceMockFns.mockDeleteFiles,
  headObject: storageServiceMockFns.mockHeadObject,
  generatePresignedDownloadUrl: storageServiceMockFns.mockGeneratePresignedDownloadUrl,
  hasCloudStorage: storageServiceMockFns.mockHasCloudStorage,
  getS3InfoForKey: storageServiceMockFns.mockGetS3InfoForKey,
  createBlobConfig: storageServiceMockFns.mockCreateBlobConfig,
  createS3Config: storageServiceMockFns.mockCreateS3Config,
  createGcsConfig: storageServiceMockFns.mockCreateGcsConfig,
}
