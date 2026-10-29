import { isRecordLike } from '@sim/utils/object'
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  type WorkspaceFileListPage,
  workspaceFilesKeys,
} from '@/hooks/queries/utils/workspace-file-keys'

/**
 * The cache entries that hold workspace file metadata, one per read shape. A file can sit in
 * several at once — a list page, a search result, a lookup, its own record — so a write has to
 * reach all of them, and a reader looking for a record it already has can find it in any.
 */
const METADATA_READS = ['list', 'search', 'lookup', 'record'] as const

type ListData = InfiniteData<WorkspaceFileListPage, string | null>
type SearchData = WorkspaceFileRecord[]
type LookupData = WorkspaceFileRecord | null
type RecordData = WorkspaceFileRecord | null

/** Whether `queryKey` is one of {@link METADATA_READS} for `workspaceId`. */
export function isWorkspaceFileMetadataKey(queryKey: QueryKey, workspaceId: string): boolean {
  return (
    queryKey[0] === workspaceFilesKeys.all[0] &&
    METADATA_READS.some((read) => read === queryKey[1]) &&
    queryKey[2] === workspaceId
  )
}

/** Every metadata read of the workspace, for `refetchQueries`/`isFetching`/`cancelQueries`. */
export function workspaceFileMetadataFilter(workspaceId: string) {
  return {
    predicate: (query: { queryKey: QueryKey }) =>
      isWorkspaceFileMetadataKey(query.queryKey, workspaceId),
  }
}

/**
 * Invalidates every metadata read of the workspace — list walks, searches, folder rollups,
 * lookups, and records — and settles once the mounted ones have refetched.
 */
export function invalidateWorkspaceFileReads(queryClient: QueryClient, workspaceId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceLists(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceSearches(workspaceId) }),
    queryClient.invalidateQueries({
      queryKey: workspaceFilesKeys.workspaceFolderStats(workspaceId),
    }),
    queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceLookups(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceRecords(workspaceId) }),
  ])
}

/** The files a cached metadata read holds, by the read's shape (its key's second segment). */
function filesOf(queryKey: QueryKey, data: unknown): readonly WorkspaceFileRecord[] {
  if (!data) return []
  switch (queryKey[1]) {
    case 'list':
      /** Only a live list seeds a live read: an archived one holds deleted files. */
      return isRecordLike(queryKey[3]) && queryKey[3].scope === 'active'
        ? (data as ListData).pages.flatMap((page) => page.files)
        : []
    case 'search':
      return data as SearchData
    case 'lookup':
    case 'record':
      return [data as WorkspaceFileRecord]
    default:
      return []
  }
}

/**
 * The freshest copy of a file any cached read of its workspace holds, and when that read last
 * succeeded, without fetching. `undefined` when no read has seen it. A record a reader opens
 * this way starts from what the list it was clicked in already showed, aged as that list is.
 */
export function findCachedWorkspaceFile(
  queryClient: QueryClient,
  workspaceId: string,
  match: (file: WorkspaceFileRecord) => boolean
): { file: WorkspaceFileRecord; updatedAt: number } | undefined {
  let found: { file: WorkspaceFileRecord; updatedAt: number } | undefined
  for (const query of queryClient
    .getQueryCache()
    .findAll(workspaceFileMetadataFilter(workspaceId))) {
    const { data, dataUpdatedAt } = query.state
    if (found && dataUpdatedAt <= found.updatedAt) continue
    // Each read's data shape is fixed by its key segment, which `filesOf` switches on.
    const file = filesOf(query.queryKey, data).find(match)
    if (file) found = { file, updatedAt: dataUpdatedAt }
  }
  return found
}

/** The cached metadata entries of one workspace, as `getQueriesData` returns them, for a rollback. */
export type WorkspaceFileReadSnapshot = [QueryKey, unknown][]

/** Every cached metadata read of the workspace, for an optimistic write to restore on failure. */
export function snapshotWorkspaceFileReads(
  queryClient: QueryClient,
  workspaceId: string
): WorkspaceFileReadSnapshot {
  return queryClient.getQueriesData(workspaceFileMetadataFilter(workspaceId))
}

export function restoreWorkspaceFileReads(
  queryClient: QueryClient,
  snapshot: WorkspaceFileReadSnapshot
): void {
  for (const [queryKey, data] of snapshot) queryClient.setQueryData(queryKey, data)
}

/**
 * Rewrites one file in every cached read of its workspace: `update` returns the new record, or
 * `null` to drop the file (a delete). Lists, searches, and lookups lose a dropped file; its own
 * record is left for the caller, since a reader still on it is mid-navigation away.
 */
export function updateCachedWorkspaceFile(
  queryClient: QueryClient,
  workspaceId: string,
  fileId: string,
  update: (file: WorkspaceFileRecord) => WorkspaceFileRecord | null
): void {
  const apply = (files: WorkspaceFileRecord[]) => {
    let changed = false
    const next: WorkspaceFileRecord[] = []
    for (const file of files) {
      if (file.id !== fileId) {
        next.push(file)
        continue
      }
      changed = true
      const updated = update(file)
      if (updated) next.push(updated)
    }
    return changed ? next : files
  }

  queryClient.setQueriesData<ListData>(
    { queryKey: workspaceFilesKeys.workspaceLists(workspaceId) },
    (data) => {
      if (!data) return data
      let changed = false
      const pages = data.pages.map((page) => {
        const files = apply(page.files)
        if (files === page.files) return page
        changed = true
        return { ...page, files }
      })
      return changed ? { ...data, pages } : data
    }
  )
  queryClient.setQueriesData<SearchData>(
    { queryKey: workspaceFilesKeys.workspaceSearches(workspaceId) },
    (data) => (data ? apply(data) : data)
  )
  queryClient.setQueriesData<LookupData>(
    { queryKey: workspaceFilesKeys.workspaceLookups(workspaceId) },
    (data) => (data?.id === fileId ? update(data) : data)
  )
  queryClient.setQueryData<RecordData>(workspaceFilesKeys.record(workspaceId, fileId), (data) =>
    data ? (update(data) ?? data) : data
  )
}
