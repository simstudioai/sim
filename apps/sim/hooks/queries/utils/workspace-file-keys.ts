import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import type { WorkspaceFileKind, WorkspaceFileSizeBucket } from '@/lib/workspace-files/list-filters'

export type WorkspaceFileListScope = 'active' | 'archived'
export type WorkspaceFileListSortBy = 'name' | 'size' | 'uploadedAt' | 'updatedAt'
export type WorkspaceFileListSortOrder = 'asc' | 'desc'

/** The default page size of a workspace file list: one round trip for nearly every folder. */
const WORKSPACE_FILE_LIST_PAGE_SIZE = 200

export const WORKSPACE_FILE_LIST_STALE_TIME = 30 * 1000
export const WORKSPACE_FILE_SEARCH_STALE_TIME = 30 * 1000
export const WORKSPACE_FILE_FOLDER_STATS_STALE_TIME = 30 * 1000
export const WORKSPACE_FILE_RECORD_STALE_TIME = 30 * 1000
export const WORKSPACE_FILE_LOOKUP_STALE_TIME = 30 * 1000

/**
 * One paged file list: which files (folder, search, filters), in which order, and how many per
 * page. Built by {@link workspaceFileListParams} so two spellings of one list share a cache entry.
 */
export interface WorkspaceFileListParams {
  scope: WorkspaceFileListScope
  /** The folder listed, `null` for the workspace root; absent lists every folder. */
  folderId?: string | null
  /** Whether `folderId`'s subfolders are listed too. */
  recursive?: boolean
  /** Case-insensitive substring of the file name. */
  q?: string
  types?: readonly WorkspaceFileKind[]
  sizes?: readonly WorkspaceFileSizeBucket[]
  uploadedBy?: readonly string[]
  sortBy: WorkspaceFileListSortBy
  sortOrder: WorkspaceFileListSortOrder
  limit: number
}

export interface WorkspaceFileListPage {
  files: WorkspaceFileRecord[]
  /** The next page's cursor, `null` on the last page. */
  nextCursor: string | null
}

export interface WorkspaceFileSearchParams {
  q: string
  /** The folder searched, `null` for the root; absent searches the workspace. */
  folderId?: string | null
  /** Whether `folderId`'s subfolders are searched too. */
  recursive?: boolean
  limit: number
}

/** Which identity a lookup resolves a file by: its id, its storage key, or an id/path/name reference. */
export type WorkspaceFileLookupKind = 'id' | 'key' | 'reference'

function canonicalSet<T extends string>(values: readonly T[] | undefined): T[] | undefined {
  if (!values || values.length === 0) return undefined
  return [...new Set(values)].sort()
}

/**
 * The canonical form of a list's params: the search trimmed and dropped when blank, set filters
 * sorted, de-duplicated, and dropped when empty, and `recursive` kept only with a folder. The
 * query key hashes this object, so equivalent lists land on one cache entry and the server
 * fetch reads exactly what the key names.
 */
export function workspaceFileListParams(input: {
  scope?: WorkspaceFileListScope
  folderId?: string | null
  recursive?: boolean
  q?: string
  types?: readonly WorkspaceFileKind[]
  sizes?: readonly WorkspaceFileSizeBucket[]
  uploadedBy?: readonly string[]
  sortBy: WorkspaceFileListSortBy
  sortOrder: WorkspaceFileListSortOrder
  limit?: number
}): WorkspaceFileListParams {
  const q = input.q?.trim()
  return {
    scope: input.scope ?? 'active',
    ...(input.folderId === undefined ? {} : { folderId: input.folderId }),
    ...(input.folderId !== undefined && input.recursive ? { recursive: true } : {}),
    ...(q ? { q } : {}),
    ...(canonicalSet(input.types) ? { types: canonicalSet(input.types) } : {}),
    ...(canonicalSet(input.sizes) ? { sizes: canonicalSet(input.sizes) } : {}),
    ...(canonicalSet(input.uploadedBy) ? { uploadedBy: canonicalSet(input.uploadedBy) } : {}),
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    limit: input.limit ?? WORKSPACE_FILE_LIST_PAGE_SIZE,
  }
}

/**
 * The `GET /api/workspaces/[id]/files` query for one page of a list: a `null` folder is spelled
 * `root`, set filters comma-joined. The client fetch and the server prefetch both send this, so
 * a prefetched page is the page its key names.
 */
export function workspaceFileListQuery(params: WorkspaceFileListParams, cursor: string | null) {
  return {
    scope: params.scope,
    ...(params.folderId === undefined
      ? {}
      : { folderId: params.folderId ?? 'root', recursive: params.recursive }),
    q: params.q,
    types: params.types?.join(','),
    sizes: params.sizes?.join(','),
    uploadedBy: params.uploadedBy?.join(','),
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
    limit: params.limit,
    ...(cursor ? { cursor } : {}),
  }
}

/**
 * Query keys for workspace files. Every metadata read — a list page walk, a search, a folder
 * rollup, a lookup, a record — is keyed under its workspace, so one file write can invalidate
 * exactly that workspace's reads (`invalidateWorkspaceFileReads`).
 *
 * Standalone, outside the hooks module, because server prefetches seed these keys.
 */
export const workspaceFilesKeys = {
  all: ['workspaceFiles'] as const,
  lists: () => [...workspaceFilesKeys.all, 'list'] as const,
  /** Every list in one workspace — also the scope a previous list may be carried within. */
  workspaceLists: (workspaceId: string) => [...workspaceFilesKeys.lists(), workspaceId] as const,
  list: (workspaceId: string, params: WorkspaceFileListParams) =>
    [...workspaceFilesKeys.workspaceLists(workspaceId), params] as const,
  searches: () => [...workspaceFilesKeys.all, 'search'] as const,
  workspaceSearches: (workspaceId: string) =>
    [...workspaceFilesKeys.searches(), workspaceId] as const,
  search: (workspaceId: string, params: WorkspaceFileSearchParams) =>
    [...workspaceFilesKeys.workspaceSearches(workspaceId), params] as const,
  folderStats: () => [...workspaceFilesKeys.all, 'folderStats'] as const,
  workspaceFolderStats: (workspaceId: string) =>
    [...workspaceFilesKeys.folderStats(), workspaceId] as const,
  folderStat: (workspaceId: string, parentId: string | null) =>
    [...workspaceFilesKeys.workspaceFolderStats(workspaceId), parentId ?? 'root'] as const,
  lookups: () => [...workspaceFilesKeys.all, 'lookup'] as const,
  workspaceLookups: (workspaceId: string) =>
    [...workspaceFilesKeys.lookups(), workspaceId] as const,
  lookup: (workspaceId: string, kind: WorkspaceFileLookupKind, value: string) =>
    [...workspaceFilesKeys.workspaceLookups(workspaceId), kind, value] as const,
  records: () => [...workspaceFilesKeys.all, 'record'] as const,
  workspaceRecords: (workspaceId: string) =>
    [...workspaceFilesKeys.records(), workspaceId] as const,
  record: (workspaceId: string, fileId: string) =>
    [...workspaceFilesKeys.workspaceRecords(workspaceId), fileId] as const,
  contents: () => [...workspaceFilesKeys.all, 'content'] as const,
  contentFile: (workspaceId: string, fileId: string) =>
    [...workspaceFilesKeys.contents(), workspaceId, fileId] as const,
  content: (
    workspaceId: string,
    fileId: string,
    mode: 'text' | 'raw' | 'binary' = 'text',
    storageKey?: string
  ) =>
    [
      ...workspaceFilesKeys.contentFile(workspaceId, fileId),
      mode,
      ...(storageKey ? [storageKey] : []),
    ] as const,
  storageInfo: () => [...workspaceFilesKeys.all, 'storageInfo'] as const,
  cloudConfigured: () => [...workspaceFilesKeys.all, 'cloudConfigured'] as const,
}
