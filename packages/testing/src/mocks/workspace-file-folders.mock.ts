import { vi } from 'vitest'
import {
  MockWorkspaceFileFolderConflictError,
  MockWorkspaceFileItemsNotFoundError,
  MockWorkspaceFileMoveConflictError,
} from './workspace-uploads.mock'

interface MockFolderPathSource {
  id: string
  name: string
  parentId: string | null
}

function encodeFolderSegment(name: string): string {
  if (name.length === 0) throw new Error('Workspace file folder names cannot be empty')
  return name.replaceAll('\\', '\\\\').replaceAll('/', '\\/')
}

function buildWorkspaceFileFolderPathMapImpl(folders: MockFolderPathSource[]): Map<string, string> {
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
    const encodedName = encodeFolderSegment(folder.name)
    const path = parentPath ? `${parentPath}/${encodedName}` : encodedName
    paths.set(folderId, path)
    return path
  }
  for (const folder of folders) resolve(folder.id)
  return paths
}

/**
 * Controllable mock functions for `@/lib/uploads/contexts/workspace/workspace-file-folder-manager`.
 *
 * Bare `vi.fn()` except:
 * - `mockNormalizeWorkspaceFileItemName` → faithful port (trims; throws on empty names, path
 *   separators and dot segments).
 * - `mockBuildWorkspaceFileFolderPathMap` → faithful port (folder id → encoded display path).
 * - `mockAssertWorkspaceFileFolderTarget` / `mockResolveWorkspaceFileFolderTarget` resolve `null`
 *   (the root folder).
 * - `mockFileNameExistsInWorkspaceFolder` resolves `false`.
 * - `mockListWorkspaceFileFolders` resolves `[]`.
 *
 * @example
 * ```ts
 * import { workspaceFileFoldersMockFns } from '@sim/testing/mocks/workspace-file-folders.mock'
 *
 * workspaceFileFoldersMockFns.mockResolveWorkspaceFileFolderTarget.mockResolvedValue('folder-1')
 * ```
 */
export const workspaceFileFoldersMockFns = {
  mockLoadWorkspaceFileOperationContext: vi.fn(),
  mockAssertWorkspaceFileItemsBelongToWorkspace: vi.fn(),
  mockNormalizeWorkspaceFileItemName: vi.fn(
    (name: string, itemLabel: 'File' | 'Folder' = 'File'): string => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error(`${itemLabel} name is required`)
      if (trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
        throw new Error(`${itemLabel} name cannot contain path separators or dot segments`)
      }
      return trimmed
    }
  ),
  mockBuildWorkspaceFileFolderPathMap: vi.fn(buildWorkspaceFileFolderPathMapImpl),
  mockGetWorkspaceFileFolderPath: vi.fn(),
  mockFindWorkspaceFileFolderIdByPath: vi.fn(),
  mockListWorkspaceFileFolders: vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  mockGetWorkspaceFileFolder: vi.fn(),
  mockResolveWorkspaceFileFolderTarget: vi.fn(
    async (..._args: unknown[]): Promise<string | null> => null
  ),
  mockAssertWorkspaceFileFolderTarget: vi.fn(
    async (..._args: unknown[]): Promise<string | null> => null
  ),
  mockCreateWorkspaceFileFolder: vi.fn(),
  mockEnsureWorkspaceFileFolderPath: vi.fn(),
  mockUpdateWorkspaceFileFolder: vi.fn(),
  mockFileNameExistsInWorkspaceFolder: vi.fn(
    async (..._args: unknown[]): Promise<boolean> => false
  ),
  mockMoveWorkspaceFileItems: vi.fn(),
  mockRestoreWorkspaceFileFolder: vi.fn(),
  mockBulkArchiveWorkspaceFileItems: vi.fn(),
  mockCreateWorkspaceFileFolderAtPath: vi.fn(),
  mockRelocateWorkspaceFileFolderByPath: vi.fn(),
  mockDeleteWorkspaceFileFolderByPath: vi.fn(),
  mockArchiveWorkspaceFileFolderIfEmpty: vi.fn(),
}

const fns = workspaceFileFoldersMockFns

/**
 * Static mock module for `@/lib/uploads/contexts/workspace/workspace-file-folder-manager`. Error
 * classes are the `Mock*Error` mirrors shared with `workspace-uploads.mock` (one class per real error).
 *
 * @example
 * ```ts
 * vi.mock(
 *   '@/lib/uploads/contexts/workspace/workspace-file-folder-manager',
 *   () => workspaceFileFoldersMock
 * )
 * ```
 */
export const workspaceFileFoldersMock = {
  WorkspaceFileFolderConflictError: MockWorkspaceFileFolderConflictError,
  WorkspaceFileMoveConflictError: MockWorkspaceFileMoveConflictError,
  WorkspaceFileItemsNotFoundError: MockWorkspaceFileItemsNotFoundError,
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
