import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/folders/orchestration` — the generic,
 * resourceType-driven folder engine behind every `/api/folders` route, plus the path-addressed
 * `*AtPath` / `*ByPath` operations (and their `*Transition` forms) the VFS and copilot tools use.
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
  mockNextFolderSortOrder: vi.fn(),
  mockCreateFolderAtPath: vi.fn(),
  mockCreateFolderAtPathTransition: vi.fn(),
  mockRelocateFolderByPath: vi.fn(),
  mockRelocateFolderByPathTransition: vi.fn(),
  mockDeleteFolderByPath: vi.fn(),
  mockDeleteFolderByPathTransition: vi.fn(),
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
  nextFolderSortOrder: foldersOrchestrationMockFns.mockNextFolderSortOrder,
  createFolderAtPath: foldersOrchestrationMockFns.mockCreateFolderAtPath,
  createFolderAtPathTransition: foldersOrchestrationMockFns.mockCreateFolderAtPathTransition,
  relocateFolderByPath: foldersOrchestrationMockFns.mockRelocateFolderByPath,
  relocateFolderByPathTransition: foldersOrchestrationMockFns.mockRelocateFolderByPathTransition,
  deleteFolderByPath: foldersOrchestrationMockFns.mockDeleteFolderByPath,
  deleteFolderByPathTransition: foldersOrchestrationMockFns.mockDeleteFolderByPathTransition,
}
