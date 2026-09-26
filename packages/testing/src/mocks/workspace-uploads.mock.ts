import { vi } from 'vitest'
import {
  workspaceFileManagerMock,
  workspaceFileManagerMockFns,
} from './workspace-file-manager.mock'

/**
 * Real `WorkspaceFileFolderConflictError` stand-in: same `name`, `code` and message. Extends
 * `Error`, not the app's `OrchestrationError` (see {@link workspaceUploadsMock}).
 */
export class MockWorkspaceFileFolderConflictError extends Error {
  readonly code = 'conflict' as const

  constructor(name: string) {
    super(`A folder named "${name}" already exists in this location`)
    this.name = 'WorkspaceFileFolderConflictError'
  }
}

/** Real `WorkspaceFileMoveConflictError` stand-in: same `name`, `code` and message. */
export class MockWorkspaceFileMoveConflictError extends Error {
  readonly code = 'conflict' as const

  constructor(name: string) {
    super(`A file named "${name}" already exists in the destination folder`)
    this.name = 'WorkspaceFileMoveConflictError'
  }
}

/** Real `WorkspaceFileItemsNotFoundError` stand-in: same `name`, `code` and message. */
export class MockWorkspaceFileItemsNotFoundError extends Error {
  readonly code = 'not_found' as const

  constructor(fileIds: string[], folderIds: string[]) {
    const parts = [
      fileIds.length > 0 ? `files: ${fileIds.join(', ')}` : null,
      folderIds.length > 0 ? `folders: ${folderIds.join(', ')}` : null,
    ].filter(Boolean)
    super(`Workspace file items not found (${parts.join('; ')})`)
    this.name = 'WorkspaceFileItemsNotFoundError'
  }
}

/** Real `ExternalUrlValidationError` stand-in: same `name` and message. */
export class MockExternalUrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExternalUrlValidationError'
  }
}

/** Structural stand-in for a folder row passed to `buildWorkspaceFileFolderPathMap`. */
interface MockFolderPathRow {
  id: string
  name: string
  parentId?: string | null
}

/**
 * Controllable mock functions for the folder-manager and external-URL halves of the
 * `@/lib/uploads/contexts/workspace` barrel. The file-manager half is
 * `workspaceFileManagerMockFns` (re-exported here as `...workspaceFileManagerMockFns`).
 *
 * I/O functions are bare `vi.fn()`s. `normalizeWorkspaceFileItemName` is a faithful port;
 * `buildWorkspaceFileFolderPathMap` is faithful except that it does not escape `/` or `\`
 * inside folder names.
 *
 * @example
 * ```ts
 * import { workspaceUploadsMockFns } from '@sim/testing/mocks/workspace-uploads.mock'
 *
 * workspaceUploadsMockFns.mockListWorkspaceFileFolders.mockResolvedValue([])
 * workspaceUploadsMockFns.mockGetWorkspaceFile.mockResolvedValue(file)
 * ```
 */
export const workspaceUploadsMockFns = {
  ...workspaceFileManagerMockFns,
  mockFetchExternalUrlToWorkspace: vi.fn(),
  mockLoadWorkspaceFileOperationContext: vi.fn(),
  mockAssertWorkspaceFileItemsBelongToWorkspace: vi.fn(),
  mockNormalizeWorkspaceFileItemName: vi.fn((name: string, itemLabel: 'File' | 'Folder') => {
    const trimmed = name.trim()
    if (!trimmed) throw new Error(`${itemLabel} name is required`)
    if (trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
      throw new Error(`${itemLabel} name cannot contain path separators or dot segments`)
    }
    return trimmed
  }),
  mockBuildWorkspaceFileFolderPathMap: vi.fn((folders: MockFolderPathRow[]) => {
    const folderMap = new Map(folders.map((folder) => [folder.id, folder]))
    const paths = new Map<string, string>()
    const resolve = (folderId: string, seen = new Set<string>()): string => {
      const cached = paths.get(folderId)
      if (cached != null) return cached
      const folder = folderMap.get(folderId)
      if (!folder || seen.has(folderId)) return ''
      const nextSeen = new Set(seen)
      nextSeen.add(folderId)
      const parentPath = folder.parentId ? resolve(folder.parentId, nextSeen) : ''
      const path = parentPath ? `${parentPath}/${folder.name}` : folder.name
      paths.set(folderId, path)
      return path
    }
    for (const folder of folders) resolve(folder.id)
    return paths
  }),
  mockGetWorkspaceFileFolderPath: vi.fn(),
  mockFindWorkspaceFileFolderIdByPath: vi.fn(),
  mockListWorkspaceFileFolders: vi.fn(),
  mockGetWorkspaceFileFolder: vi.fn(),
  mockResolveWorkspaceFileFolderTarget: vi.fn(),
  mockAssertWorkspaceFileFolderTarget: vi.fn(),
  mockCreateWorkspaceFileFolder: vi.fn(),
  mockEnsureWorkspaceFileFolderPath: vi.fn(),
  mockUpdateWorkspaceFileFolder: vi.fn(),
  mockFileNameExistsInWorkspaceFolder: vi.fn(),
  mockMoveWorkspaceFileItems: vi.fn(),
  mockRestoreWorkspaceFileFolder: vi.fn(),
  mockBulkArchiveWorkspaceFileItems: vi.fn(),
  mockCreateWorkspaceFileFolderAtPath: vi.fn(),
  mockRelocateWorkspaceFileFolderByPath: vi.fn(),
  mockDeleteWorkspaceFileFolderByPath: vi.fn(),
  mockArchiveWorkspaceFileFolderIfEmpty: vi.fn(),
}

const fns = workspaceUploadsMockFns

/**
 * Static mock module for the `@/lib/uploads/contexts/workspace` barrel
 * (`workspace-file-manager` + `workspace-file-folder-manager` + `fetch-external-url`).
 *
 * The error classes extend `Error`, not `OrchestrationError`: their `name`, `code` and
 * message match production, but `instanceof OrchestrationError` is false.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/uploads/contexts/workspace', () => workspaceUploadsMock)
 * ```
 */
export const workspaceUploadsMock = {
  ...workspaceFileManagerMock,
  ExternalUrlValidationError: MockExternalUrlValidationError,
  WorkspaceFileFolderConflictError: MockWorkspaceFileFolderConflictError,
  WorkspaceFileMoveConflictError: MockWorkspaceFileMoveConflictError,
  WorkspaceFileItemsNotFoundError: MockWorkspaceFileItemsNotFoundError,
  fetchExternalUrlToWorkspace: fns.mockFetchExternalUrlToWorkspace,
  loadWorkspaceFileOperationContext: fns.mockLoadWorkspaceFileOperationContext,
  assertWorkspaceFileItemsBelongToWorkspace: fns.mockAssertWorkspaceFileItemsBelongToWorkspace,
  normalizeWorkspaceFileItemName: fns.mockNormalizeWorkspaceFileItemName,
  buildWorkspaceFileFolderPathMap: fns.mockBuildWorkspaceFileFolderPathMap,
  getWorkspaceFileFolderPath: fns.mockGetWorkspaceFileFolderPath,
  findWorkspaceFileFolderIdByPath: fns.mockFindWorkspaceFileFolderIdByPath,
  listWorkspaceFileFolders: fns.mockListWorkspaceFileFolders,
  getWorkspaceFileFolder: fns.mockGetWorkspaceFileFolder,
  resolveWorkspaceFileFolderTarget: fns.mockResolveWorkspaceFileFolderTarget,
  assertWorkspaceFileFolderTarget: fns.mockAssertWorkspaceFileFolderTarget,
  createWorkspaceFileFolder: fns.mockCreateWorkspaceFileFolder,
  ensureWorkspaceFileFolderPath: fns.mockEnsureWorkspaceFileFolderPath,
  updateWorkspaceFileFolder: fns.mockUpdateWorkspaceFileFolder,
  fileNameExistsInWorkspaceFolder: fns.mockFileNameExistsInWorkspaceFolder,
  moveWorkspaceFileItems: fns.mockMoveWorkspaceFileItems,
  restoreWorkspaceFileFolder: fns.mockRestoreWorkspaceFileFolder,
  bulkArchiveWorkspaceFileItems: fns.mockBulkArchiveWorkspaceFileItems,
  createWorkspaceFileFolderAtPath: fns.mockCreateWorkspaceFileFolderAtPath,
  relocateWorkspaceFileFolderByPath: fns.mockRelocateWorkspaceFileFolderByPath,
  deleteWorkspaceFileFolderByPath: fns.mockDeleteWorkspaceFileFolderByPath,
  archiveWorkspaceFileFolderIfEmpty: fns.mockArchiveWorkspaceFileFolderIfEmpty,
}
