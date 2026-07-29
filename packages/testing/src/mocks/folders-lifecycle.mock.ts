import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/folders/lifecycle` — the generic,
 * resourceType-driven folder engine behind every `/api/folders` route.
 * All defaults are bare `vi.fn()` — configure per-test as needed.
 *
 * @example
 * ```ts
 * import { foldersLifecycleMockFns } from '@sim/testing'
 *
 * foldersLifecycleMockFns.mockCreateFolder.mockResolvedValue({ success: true, folder })
 * ```
 */
export const foldersLifecycleMockFns = {
  mockCreateFolder: vi.fn(),
  mockUpdateFolder: vi.fn(),
  mockDeleteFolder: vi.fn(),
  mockRestoreFolder: vi.fn(),
}

/**
 * Static mock module for `@/lib/folders/lifecycle`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/folders/lifecycle', () => foldersLifecycleMock)
 * ```
 */
export const foldersLifecycleMock = {
  createFolder: foldersLifecycleMockFns.mockCreateFolder,
  updateFolder: foldersLifecycleMockFns.mockUpdateFolder,
  deleteFolder: foldersLifecycleMockFns.mockDeleteFolder,
  restoreFolder: foldersLifecycleMockFns.mockRestoreFolder,
}
