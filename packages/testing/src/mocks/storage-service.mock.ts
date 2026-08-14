import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/uploads/core/storage-service`.
 * All defaults are bare `vi.fn()` — configure per-test as needed.
 *
 * @example
 * ```ts
 * import { storageServiceMockFns } from '@sim/testing'
 *
 * storageServiceMockFns.mockHasCloudStorage.mockReturnValue(true)
 * storageServiceMockFns.mockGeneratePresignedDownloadUrl.mockResolvedValue('https://s3/test')
 * ```
 */
export const storageServiceMockFns = {
  mockUploadFile: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockHeadObject: vi.fn(),
  mockGeneratePresignedDownloadUrl: vi.fn(),
  mockHasCloudStorage: vi.fn(() => false),
  mockGetS3InfoForKey: vi.fn(),
}

/**
 * Static mock module for `@/lib/uploads/core/storage-service`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
 * ```
 */
export const storageServiceMock = {
  uploadFile: storageServiceMockFns.mockUploadFile,
  downloadFile: storageServiceMockFns.mockDownloadFile,
  deleteFile: storageServiceMockFns.mockDeleteFile,
  headObject: storageServiceMockFns.mockHeadObject,
  generatePresignedDownloadUrl: storageServiceMockFns.mockGeneratePresignedDownloadUrl,
  hasCloudStorage: storageServiceMockFns.mockHasCloudStorage,
  getS3InfoForKey: storageServiceMockFns.mockGetS3InfoForKey,
}
