import { vi } from 'vitest'
import { storageServiceMock } from './storage-service.mock'

/**
 * Controllable mock functions for the `@/lib/uploads` barrel.
 *
 * Defaults describe local storage: `isUsingCloudStorage` → `false`,
 * `getStorageProvider` → `'local'`, `getServePathPrefix` → `'/api/files/serve/'` (the real
 * constant). The `StorageService` namespace is `storageServiceMock`, so drive storage I/O
 * through `storageServiceMockFns` from `@sim/testing/mocks/storage-service.mock`.
 *
 * @example
 * ```ts
 * import { uploadsMockFns } from '@sim/testing/mocks/uploads.mock'
 * import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
 *
 * uploadsMockFns.mockIsUsingCloudStorage.mockReturnValue(true)
 * storageServiceMockFns.mockUploadFile.mockResolvedValue({ key: 'execution/ws/file.txt' })
 * ```
 */
export const uploadsMockFns = {
  mockGetStorageConfig: vi.fn(),
  mockIsUsingCloudStorage: vi.fn(() => false),
  mockGetFileMetadata: vi.fn(),
  mockGetServePathPrefix: vi.fn(() => '/api/files/serve/'),
  mockGetStorageProvider: vi.fn((): 'blob' | 's3' | 'gcs' | 'local' => 'local'),
  mockProcessChatFiles: vi.fn(),
  mockDownloadCopilotFile: vi.fn(),
  mockUploadCopilotFile: vi.fn(),
}

/**
 * Static mock module for `@/lib/uploads`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/uploads', () => uploadsMock)
 * ```
 */
export const uploadsMock = {
  getStorageConfig: uploadsMockFns.mockGetStorageConfig,
  isUsingCloudStorage: uploadsMockFns.mockIsUsingCloudStorage,
  getFileMetadata: uploadsMockFns.mockGetFileMetadata,
  getServePathPrefix: uploadsMockFns.mockGetServePathPrefix,
  getStorageProvider: uploadsMockFns.mockGetStorageProvider,
  ChatFiles: {
    processChatFiles: uploadsMockFns.mockProcessChatFiles,
  },
  CopilotFiles: {
    downloadCopilotFile: uploadsMockFns.mockDownloadCopilotFile,
    uploadCopilotFile: uploadsMockFns.mockUploadCopilotFile,
  },
  StorageService: storageServiceMock,
}
