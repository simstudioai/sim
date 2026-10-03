import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/uploads/utils/file-utils.server`.
 * Every export is I/O (storage reads, URL fetches, presigning), so all defaults are bare
 * `vi.fn()` — configure per test.
 *
 * @example
 * ```ts
 * import { fileUtilsServerMockFns } from '@sim/testing/mocks/file-utils-server.mock'
 *
 * fileUtilsServerMockFns.mockDownloadServableFileFromStorage.mockResolvedValue({
 *   buffer: Buffer.from('bytes'),
 * })
 * ```
 */
export const fileUtilsServerMockFns = {
  mockResolveFileInputToUrl: vi.fn(),
  mockDownloadFileFromUrl: vi.fn(),
  mockResolveInternalFileUrl: vi.fn(),
  mockDownloadFileFromStorage: vi.fn(),
  mockDownloadServableFileFromStorage: vi.fn(),
  mockDownloadServableFilesWithinBudget: vi.fn(),
}

/**
 * Static mock module for `@/lib/uploads/utils/file-utils.server`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
 * ```
 */
export const fileUtilsServerMock = {
  resolveFileInputToUrl: fileUtilsServerMockFns.mockResolveFileInputToUrl,
  downloadFileFromUrl: fileUtilsServerMockFns.mockDownloadFileFromUrl,
  resolveInternalFileUrl: fileUtilsServerMockFns.mockResolveInternalFileUrl,
  downloadFileFromStorage: fileUtilsServerMockFns.mockDownloadFileFromStorage,
  downloadServableFileFromStorage: fileUtilsServerMockFns.mockDownloadServableFileFromStorage,
  downloadServableFilesWithinBudget: fileUtilsServerMockFns.mockDownloadServableFilesWithinBudget,
}
