import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/folders/orchestration` — the generic,
 * resourceType-driven folder engine behind every `/api/folders` route.
 * All defaults are bare `vi.fn()` — configure per-test as needed.
 *
 * @example
 * ```ts
 * import { foldersOrchestrationMockFns } from '@sim/testing'
 *
 * foldersOrchestrationMockFns.mockCreateFolder.mockResolvedValue({ success: true, folder })
 * ```
 */
export const foldersOrchestrationMockFns = {
  mockCreateFolder: vi.fn(),
  mockUpdateFolder: vi.fn(),
  mockDeleteFolder: vi.fn(),
  mockRestoreFolder: vi.fn(),
}

/**
 * Static mock module for `@/lib/folders/orchestration`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/folders/orchestration', () => foldersOrchestrationMock)
 * ```
 */
export const foldersOrchestrationMock = {
  createFolder: foldersOrchestrationMockFns.mockCreateFolder,
  updateFolder: foldersOrchestrationMockFns.mockUpdateFolder,
  deleteFolder: foldersOrchestrationMockFns.mockDeleteFolder,
  restoreFolder: foldersOrchestrationMockFns.mockRestoreFolder,
}
