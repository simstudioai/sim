import { isRecordLike } from '@sim/utils/object'
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  type WorkspaceFileListPage,
  workspaceFilesKeys,
} from '@/hooks/queries/utils/workspace-file-keys'

/**
 * The cache entries that hold workspace file records, one per read shape. A file can sit in
 * several at once — a list page, a search result, a lookup, its own record — so a write has to
 * reach each one it affects, and a reader looking for a record it already has can find it in any.
 */
const FILE_READS = ['list', 'search', 'lookup', 'record'] as const

/** Every workspace file metadata read: the {@link FILE_READS} and the folder size rollups. */
const METADATA_READS = [...FILE_READS, 'folderStats'] as const

type ListData = InfiniteData<WorkspaceFileListPage, string | null>
type SearchData = WorkspaceFileRecord[]
type LookupData = WorkspaceFileRecord | null
type RecordData = WorkspaceFileRecord | null

function isReadOf(
  reads: readonly string[],
  queryKey: QueryKey,
  workspaceId: string | undefined
): boolean {
  return (
    queryKey[0] === workspaceFilesKeys.all[0] &&
    reads.includes(String(queryKey[1])) &&
    (workspaceId === undefined || queryKey[2] === workspaceId)
  )
}

/** Whether `queryKey` holds file records of `workspaceId` (of any workspace when omitted). */
export function isWorkspaceFileRecordKey(queryKey: QueryKey, workspaceId?: string): boolean {
  return isReadOf(FILE_READS, queryKey, workspaceId)
}

/** Every metadata read of the workspace, for `invalidateQueries`/`refetchQueries`/`cancelQueries`. */
export function workspaceFileMetadataFilter(workspaceId: string) {
  return {
    predicate: (query: { queryKey: QueryKey }) =>
      isReadOf(METADATA_READS, query.queryKey, workspaceId),
  }
}

/** A list of live files: an archived list holds deleted files, which no live read should see. */
function isLiveList(queryKey: QueryKey): boolean {
  return queryKey[1] === 'list' && isRecordLike(queryKey[3]) && queryKey[3].scope === 'active'
}

/**
 * Cuts each unobserved list of the workspace back to its first page, so the refetch an
 * invalidation leaves for its next mount reads one page instead of every page it once walked.
 * A mounted list keeps its pages: the rows on screen stay where they are while it refetches.
 */
function trimUnobservedLists(queryClient: QueryClient, workspaceId: string): void {
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: workspaceFilesKeys.workspaceLists(workspaceId) })) {
    // A list key's data is always its infinite query's pages.
    const data = query.state.data as ListData | undefined
    if (query.getObserversCount() > 0 || !data || data.pages.length <= 1) continue
    queryClient.setQueryData<ListData>(
      query.queryKey,
      { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) },
      { updatedAt: query.state.dataUpdatedAt }
    )
  }
}

/**
 * Invalidates every metadata read of the workspace — list walks, searches, folder rollups,
 * lookups, and records — and settles once the mounted ones have refetched.
 */
export function invalidateWorkspaceFileReads(queryClient: QueryClient, workspaceId: string) {
  trimUnobservedLists(queryClient, workspaceId)
  return queryClient.invalidateQueries(workspaceFileMetadataFilter(workspaceId))
}

/**
 * Invalidates the reads whose membership or order a write to one file can change — lists,
 * searches, name references, and (with `folderStats`) folder sizes — for a write that patched
 * the file's own record and identity lookups instead. Settles once the mounted ones refetched.
 */
export function invalidateWorkspaceFileListings(
  queryClient: QueryClient,
  workspaceId: string,
  options: { folderStats?: boolean } = {}
) {
  trimUnobservedLists(queryClient, workspaceId)
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceLists(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceSearches(workspaceId) }),
    queryClient.invalidateQueries({
      queryKey: [...workspaceFilesKeys.workspaceLookups(workspaceId), 'reference'],
    }),
    options.folderStats
      ? queryClient.invalidateQueries({
          queryKey: workspaceFilesKeys.workspaceFolderStats(workspaceId),
        })
      : undefined,
  ])
}

/** The files a cached read holds, by the read's shape (its key's second segment). */
function filesOf(queryKey: QueryKey, data: unknown): readonly WorkspaceFileRecord[] {
  if (!data) return []
  // Each read's data shape is fixed by its key segment, which this switches on.
  switch (queryKey[1]) {
    case 'list':
      return isLiveList(queryKey) ? (data as ListData).pages.flatMap((page) => page.files) : []
    case 'search':
      return data as SearchData
    case 'lookup':
    case 'record':
      return [data as WorkspaceFileRecord]
    default:
      return []
  }
}

/** A cached copy of a file and when the read holding it last succeeded. */
export interface CachedWorkspaceFile {
  file: WorkspaceFileRecord
  updatedAt: number
}

/**
 * The freshest copy of each file any cached read of the workspace holds, by `field`, without
 * fetching — one scan for a caller resolving many values. A record a reader opens this way
 * starts from what the list it was clicked in already showed, aged as that list is.
 */
export function indexCachedWorkspaceFiles(
  queryClient: QueryClient,
  workspaceId: string,
  field: 'id' | 'key'
): ReadonlyMap<string, CachedWorkspaceFile> {
  const index = new Map<string, CachedWorkspaceFile>()
  for (const query of queryClient.getQueryCache().findAll()) {
    if (!isWorkspaceFileRecordKey(query.queryKey, workspaceId)) continue
    const { data, dataUpdatedAt } = query.state
    for (const file of filesOf(query.queryKey, data)) {
      const known = index.get(file[field])
      if (!known || dataUpdatedAt > known.updatedAt) {
        index.set(file[field], { file, updatedAt: dataUpdatedAt })
      }
    }
  }
  return index
}

/** The freshest cached copy of one file that passes `match`; see {@link indexCachedWorkspaceFiles}. */
export function findCachedWorkspaceFile(
  queryClient: QueryClient,
  workspaceId: string,
  match: (file: WorkspaceFileRecord) => boolean
): CachedWorkspaceFile | undefined {
  let found: CachedWorkspaceFile | undefined
  for (const query of queryClient.getQueryCache().findAll()) {
    if (!isWorkspaceFileRecordKey(query.queryKey, workspaceId)) continue
    const { data, dataUpdatedAt } = query.state
    if (found && dataUpdatedAt <= found.updatedAt) continue
    const file = filesOf(query.queryKey, data).find(match)
    if (file) found = { file, updatedAt: dataUpdatedAt }
  }
  return found
}

/**
 * A cached read a write to one file can rewrite in place:
 * - `list` and `search`: the live lists and name searches holding it;
 * - `identityLookup`: lookups by id or storage key, which a rename leaves pointing at the file;
 * - `referenceLookup`: lookups by name or path, which a rename re-points;
 * - `record`: the file's own record.
 */
export type PatchableWorkspaceFileRead =
  | 'list'
  | 'search'
  | 'identityLookup'
  | 'referenceLookup'
  | 'record'

/** Every read: what a write that changes neither a file's name nor its place can patch. */
export const EVERY_WORKSPACE_FILE_READ: readonly PatchableWorkspaceFileRead[] = [
  'list',
  'search',
  'identityLookup',
  'referenceLookup',
  'record',
]

function readOf(queryKey: QueryKey): PatchableWorkspaceFileRead | undefined {
  switch (queryKey[1]) {
    case 'list':
      return isLiveList(queryKey) ? 'list' : undefined
    case 'search':
      return 'search'
    case 'lookup':
      return queryKey[3] === 'reference' ? 'referenceLookup' : 'identityLookup'
    case 'record':
      return 'record'
    default:
      return undefined
  }
}

function patchableReadsFilter(workspaceId: string, reads: readonly PatchableWorkspaceFileRead[]) {
  return {
    predicate: (query: { queryKey: QueryKey }) => {
      if (!isWorkspaceFileRecordKey(query.queryKey, workspaceId)) return false
      const read = readOf(query.queryKey)
      return read !== undefined && reads.includes(read)
    },
  }
}

/** The cached entries an optimistic write patches, as `getQueriesData` returns them, for a rollback. */
export type WorkspaceFileReadSnapshot = [QueryKey, unknown][]

/** The cached `reads` of the workspace, for an optimistic write to restore on failure. */
export function snapshotWorkspaceFileReads(
  queryClient: QueryClient,
  workspaceId: string,
  reads: readonly PatchableWorkspaceFileRead[]
): WorkspaceFileReadSnapshot {
  return queryClient.getQueriesData(patchableReadsFilter(workspaceId, reads))
}

export function restoreWorkspaceFileReads(
  queryClient: QueryClient,
  snapshot: WorkspaceFileReadSnapshot
): void {
  for (const [queryKey, data] of snapshot) queryClient.setQueryData(queryKey, data)
}

/**
 * Rewrites one file in the cached `reads` of its workspace: `update` returns the new record, or
 * `null` to drop the file (a delete). Lists, searches, and lookups lose a dropped file; its own
 * record is left for the caller, since a reader still on it is mid-navigation away.
 *
 * Patch only reads whose membership and order the change cannot affect: a rename can move a
 * file in a name-sorted list or out of a search, so those are refetched instead.
 */
export function updateCachedWorkspaceFile(
  queryClient: QueryClient,
  workspaceId: string,
  fileId: string,
  update: (file: WorkspaceFileRecord) => WorkspaceFileRecord | null,
  reads: readonly PatchableWorkspaceFileRead[]
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

  for (const { queryKey } of queryClient
    .getQueryCache()
    .findAll(patchableReadsFilter(workspaceId, reads))) {
    switch (readOf(queryKey)) {
      case 'list':
        queryClient.setQueryData<ListData>(queryKey, (data) => {
          if (!data) return data
          let changed = false
          const pages = data.pages.map((page) => {
            const files = apply(page.files)
            if (files === page.files) return page
            changed = true
            return { ...page, files }
          })
          return changed ? { ...data, pages } : data
        })
        break
      case 'search':
        queryClient.setQueryData<SearchData>(queryKey, (data) => (data ? apply(data) : data))
        break
      case 'identityLookup':
      case 'referenceLookup':
        queryClient.setQueryData<LookupData>(queryKey, (data) =>
          data?.id === fileId ? update(data) : data
        )
        break
      case 'record':
        if (queryKey[3] !== fileId) break
        queryClient.setQueryData<RecordData>(queryKey, (data) =>
          data ? (update(data) ?? data) : data
        )
        break
    }
  }
}
