import { vi } from 'vitest'

/** `ROOT_FOLDER_PATH` from `@/lib/folders/paths`. */
const ROOT_FOLDER_PATH = '/'

interface MockFolderPathIndex {
  idByPath: Map<string, string>
}

interface MockFolderRow {
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  [key: string]: unknown
}

function resolveFolderPathFromIndexImpl(
  index: MockFolderPathIndex,
  path: string
): string | null | undefined {
  return path === ROOT_FOLDER_PATH ? null : index.idByPath.get(path)
}

/**
 * Controllable mock functions for `@/lib/folders/queries`.
 *
 * Every loader/writer is a bare `vi.fn()` (tests hand `mockLoadActiveFolderPathIndex` an index of
 * the shape `{ idByPath: Map<path, id>, ... }`). The pure helpers are faithful ports:
 * - `mockToFolderApi(row)` → the row with ISO-string `createdAt`/`updatedAt`/`deletedAt`.
 * - `mockResolveFolderPathFromIndex(index, path)` → `null` for `/`, else `index.idByPath.get(path)`.
 * - `mockResolveFolderPathFilter(index, path)` → `{ kind: 'unfiltered' }` for `undefined`,
 *   `{ kind: 'noMatch' }` for an unknown path, else `{ kind: 'folder', folderId }`.
 *
 * @example
 * ```ts
 * import { folderQueriesMockFns } from '@sim/testing/mocks/folder-queries.mock'
 *
 * folderQueriesMockFns.mockLoadActiveFolderPathIndex.mockResolvedValue({
 *   idByPath: new Map([['/Reports', 'folder-1']]),
 * })
 * ```
 */
export const folderQueriesMockFns = {
  mockToFolderApi: vi.fn((row: MockFolderRow) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  })),
  mockWouldCreateFolderCycle: vi.fn(),
  mockFindActiveFolder: vi.fn(),
  mockResolveRestoredFolderId: vi.fn(),
  mockLoadActiveFolderPathIndex: vi.fn(),
  mockAssertFolderCollectionHasRoom: vi.fn(),
  mockResolveFolderPathFromIndex: vi.fn(resolveFolderPathFromIndexImpl),
  mockResolveFolderPathFilter: vi.fn((index: MockFolderPathIndex, path: string | undefined) => {
    if (path === undefined) return { kind: 'unfiltered' as const }
    const folderId = resolveFolderPathFromIndexImpl(index, path)
    return folderId === undefined
      ? { kind: 'noMatch' as const }
      : { kind: 'folder' as const, folderId }
  }),
  mockListActiveFolderRows: vi.fn(),
  mockListFoldersForWorkspace: vi.fn(),
  mockFindArchivedFolderIdByPath: vi.fn(),
}

/**
 * Static mock module for `@/lib/folders/queries`. `FOLDER_SORTS` carries the column tokens the
 * real module resolves to under the global `@sim/db/schema` mock (`'folder.sortOrder'`, …).
 *
 * @example
 * ```ts
 * vi.mock('@/lib/folders/queries', () => folderQueriesMock)
 * ```
 */
export const folderQueriesMock = {
  FOLDER_SORTS: {
    position: ['folder.sortOrder', 'folder.createdAt'],
    name: ['folder.name', 'folder.createdAt'],
    createdAt: ['folder.createdAt'],
    updatedAt: ['folder.updatedAt', 'folder.createdAt'],
  },
  toFolderApi: folderQueriesMockFns.mockToFolderApi,
  wouldCreateFolderCycle: folderQueriesMockFns.mockWouldCreateFolderCycle,
  findActiveFolder: folderQueriesMockFns.mockFindActiveFolder,
  resolveRestoredFolderId: folderQueriesMockFns.mockResolveRestoredFolderId,
  loadActiveFolderPathIndex: folderQueriesMockFns.mockLoadActiveFolderPathIndex,
  assertFolderCollectionHasRoom: folderQueriesMockFns.mockAssertFolderCollectionHasRoom,
  resolveFolderPathFromIndex: folderQueriesMockFns.mockResolveFolderPathFromIndex,
  resolveFolderPathFilter: folderQueriesMockFns.mockResolveFolderPathFilter,
  listActiveFolderRows: folderQueriesMockFns.mockListActiveFolderRows,
  listFoldersForWorkspace: folderQueriesMockFns.mockListFoldersForWorkspace,
  findArchivedFolderIdByPath: folderQueriesMockFns.mockFindArchivedFolderIdByPath,
}
