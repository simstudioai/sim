import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { backoffWithJitter } from '@sim/utils/retry'
import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useIsFetching,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { fileStorageStatusContract } from '@/lib/api/contracts/storage-transfer'
import {
  type CreateWorkspaceFileBody,
  createWorkspaceFileContract,
  deleteWorkspaceFileContract,
  listWorkspaceFilesContract,
  lookupWorkspaceFilesContract,
  readWorkspaceFileContract,
  renameWorkspaceFileContract,
  restoreWorkspaceFileContract,
  searchWorkspaceFilesContract,
  type UpdateWorkspaceFileContentBody,
  updateWorkspaceFileContentContract,
  updateWorkspaceFileDimensionsContract,
  workspaceFileFolderStatsContract,
} from '@/lib/api/contracts/workspace-files'
import { uploadWorkspaceFileSession } from '@/lib/uploads/client/session-upload'
import { FileTextSizeError, readFileText } from '@/lib/uploads/client/text-content'
import type { UploadProgressEvent } from '@/lib/uploads/client/types'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { extractEmbeddedFileRef } from '@/lib/uploads/utils/embedded-image-ref'
import { extractStorageKey } from '@/lib/uploads/utils/file'
import type { WorkspaceFileSelection } from '@/lib/workspace-files/selection'
import type { UserFile } from '@/executor/types'
import { recentlyDeletedKeys } from '@/hooks/queries/utils/recently-deleted-keys'
import {
  findCachedWorkspaceFile,
  invalidateWorkspaceFileReads,
  restoreWorkspaceFileReads,
  snapshotWorkspaceFileReads,
  updateCachedWorkspaceFile,
  workspaceFileMetadataFilter,
} from '@/hooks/queries/utils/workspace-file-cache'
import {
  WORKSPACE_FILE_FOLDER_STATS_STALE_TIME,
  WORKSPACE_FILE_LIST_STALE_TIME,
  WORKSPACE_FILE_LOOKUP_STALE_TIME,
  WORKSPACE_FILE_RECORD_STALE_TIME,
  WORKSPACE_FILE_SEARCH_STALE_TIME,
  type WorkspaceFileListPage,
  type WorkspaceFileListParams,
  type WorkspaceFileLookupKind,
  type WorkspaceFileSearchParams,
  workspaceFileListQuery,
  workspaceFilesKeys,
} from '@/hooks/queries/utils/workspace-file-keys'
import { createWorkspaceFileLookupBatcher } from '@/hooks/queries/utils/workspace-file-lookup-batcher'
import { type ImageDimensionsSource, useFileContentSource } from '@/hooks/use-file-content-source'

const logger = createLogger('WorkspaceFilesQuery')

export const WORKSPACE_FILE_CONTENT_STALE_TIME = 30 * 1000
export const WORKSPACE_FILE_BINARY_STALE_TIME = 30 * 1000
/** Cloud storage (S3/Blob) is env-driven and does not change at runtime. */
export const CLOUD_STORAGE_CONFIGURED_STALE_TIME = Number.POSITIVE_INFINITY

async function fetchWorkspaceFileListPage(
  workspaceId: string,
  params: WorkspaceFileListParams,
  cursor: string | null,
  signal?: AbortSignal
): Promise<WorkspaceFileListPage> {
  const data = await requestJson(listWorkspaceFilesContract, {
    params: { id: workspaceId },
    query: workspaceFileListQuery(params, cursor),
    signal,
  })
  return { files: data.files, nextCursor: data.nextCursor ?? null }
}

/** The options behind one paged list. */
function getWorkspaceFileListQueryOptions(workspaceId: string, params: WorkspaceFileListParams) {
  return {
    queryKey: workspaceFilesKeys.list(workspaceId, params),
    queryFn: ({ pageParam, signal }: { pageParam: string | null; signal?: AbortSignal }) =>
      fetchWorkspaceFileListPage(workspaceId, params, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: WorkspaceFileListPage) => lastPage.nextCursor,
    staleTime: WORKSPACE_FILE_LIST_STALE_TIME,
  }
}

/** Whether two lists show the same place: one folder (or the same whole-workspace span). */
function isSameListPlace(previous: unknown, next: WorkspaceFileListParams): boolean {
  if (typeof previous !== 'object' || previous === null) return false
  const prior: Partial<WorkspaceFileListParams> = previous
  return (
    prior.scope === next.scope &&
    prior.folderId === next.folderId &&
    prior.recursive === next.recursive
  )
}

/**
 * One server-sorted, server-filtered file list, a page at a time (`fetchNextPage` loads the
 * next). Build `params` with `workspaceFileListParams`.
 *
 * A re-sort, a re-filter, or a new search keeps showing the previous rows until the new first
 * page lands, as long as the list still shows the same place. Moving to another folder never
 * carries the last folder's rows over: they would read as the new folder's contents.
 */
export function useWorkspaceFileList(
  workspaceId: string,
  params: WorkspaceFileListParams,
  options?: { enabled?: boolean }
) {
  return useInfiniteQuery({
    ...getWorkspaceFileListQueryOptions(workspaceId, params),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    placeholderData: (previous, previousQuery) => {
      const key = previousQuery?.queryKey
      return key?.[2] === workspaceId && isSameListPlace(key[3], params) ? previous : undefined
    },
  })
}

async function fetchWorkspaceFileSearch(
  workspaceId: string,
  params: WorkspaceFileSearchParams,
  signal?: AbortSignal
): Promise<WorkspaceFileRecord[]> {
  const data = await requestJson(searchWorkspaceFilesContract, {
    params: { id: workspaceId },
    query: {
      q: params.q,
      ...(params.folderId === undefined
        ? {}
        : { folderId: params.folderId ?? 'root', recursive: params.recursive }),
      limit: params.limit,
    },
    signal,
  })
  return data.files
}

/** Shared options for one name search; `params.q` must already be trimmed and non-empty. */
export function getWorkspaceFileSearchQueryOptions(
  workspaceId: string,
  params: WorkspaceFileSearchParams
) {
  return {
    queryKey: workspaceFilesKeys.search(workspaceId, params),
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      fetchWorkspaceFileSearch(workspaceId, params, signal),
    staleTime: WORKSPACE_FILE_SEARCH_STALE_TIME,
  }
}

/**
 * Up to `params.limit` live files whose name contains `params.q`, by name, for pickers and
 * mention menus. Disabled while the trimmed query is empty; pass an already-debounced query.
 */
export function useWorkspaceFileSearch(
  workspaceId: string,
  params: WorkspaceFileSearchParams,
  options?: { enabled?: boolean }
) {
  const q = params.q.trim()
  return useQuery({
    ...getWorkspaceFileSearchQueryOptions(workspaceId, { ...params, q }),
    enabled: Boolean(workspaceId) && q.length > 0 && (options?.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}

export interface WorkspaceFileFolderStat {
  fileCount: number
  sizeBytes: number
}

async function fetchWorkspaceFileFolderStats(
  workspaceId: string,
  parentId: string | null,
  signal?: AbortSignal
): Promise<Map<string, WorkspaceFileFolderStat>> {
  const data = await requestJson(workspaceFileFolderStatsContract, {
    params: { id: workspaceId },
    query: { parentId: parentId ?? 'root' },
    signal,
  })
  return new Map(
    data.folders.map(({ folderId, fileCount, sizeBytes }) => [folderId, { fileCount, sizeBytes }])
  )
}

function combineFolderSizes(
  results: { data: Map<string, WorkspaceFileFolderStat> | undefined }[]
): ReadonlyMap<string, WorkspaceFileFolderStat> {
  if (results.length === 1) return results[0].data ?? NO_FOLDER_STATS
  const merged = new Map<string, WorkspaceFileFolderStat>()
  for (const result of results) {
    for (const [folderId, stat] of result.data ?? []) merged.set(folderId, stat)
  }
  return merged
}

const NO_FOLDER_STATS: ReadonlyMap<string, WorkspaceFileFolderStat> = new Map()

/**
 * The live file count and bytes under each child folder of every parent in `parentIds` (`null`
 * for the root) — each folder's whole subtree rolled up, what a folder row shows as its size —
 * merged into one map by folder id. Several parents because search results span folders.
 */
export function useWorkspaceFileFolderSizes(
  workspaceId: string,
  parentIds: readonly (string | null)[],
  options?: { enabled?: boolean }
): ReadonlyMap<string, WorkspaceFileFolderStat> {
  const enabled = Boolean(workspaceId) && (options?.enabled ?? true)
  return useQueries({
    queries: parentIds.map((parentId) => ({
      queryKey: workspaceFilesKeys.folderStat(workspaceId, parentId),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        fetchWorkspaceFileFolderStats(workspaceId, parentId, signal),
      enabled,
      staleTime: WORKSPACE_FILE_FOLDER_STATS_STALE_TIME,
    })),
    combine: combineFolderSizes,
  })
}

const workspaceFileLookups = createWorkspaceFileLookupBatcher((workspaceId, body) =>
  requestJson(lookupWorkspaceFilesContract, { params: { id: workspaceId }, body })
)

/**
 * Shared options for resolving one file by id, storage key, or reference (an id, a VFS path,
 * or a bare name, resolved as the agent resolves it). Lookups requested together are sent as
 * one batched request. Resolves `null` for a value no live file answers to.
 */
export function getWorkspaceFileLookupQueryOptions(
  queryClient: QueryClient,
  workspaceId: string,
  kind: WorkspaceFileLookupKind,
  value: string
) {
  const cached =
    kind === 'id'
      ? () => findCachedWorkspaceFile(queryClient, workspaceId, (file) => file.id === value)
      : kind === 'key'
        ? () => findCachedWorkspaceFile(queryClient, workspaceId, (file) => file.key === value)
        : undefined
  return {
    queryKey: workspaceFilesKeys.lookup(workspaceId, kind, value),
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      workspaceFileLookups.load(workspaceId, kind, value, signal),
    staleTime: WORKSPACE_FILE_LOOKUP_STALE_TIME,
    initialData: cached ? () => cached()?.file : undefined,
    initialDataUpdatedAt: cached ? () => cached()?.updatedAt : undefined,
  }
}

/** One file by id, storage key, or reference; `data` is `null` when nothing live answers to it. */
export function useWorkspaceFileLookup(
  workspaceId: string,
  kind: WorkspaceFileLookupKind,
  value: string | undefined,
  options?: { enabled?: boolean }
) {
  const queryClient = useQueryClient()
  return useQuery({
    ...getWorkspaceFileLookupQueryOptions(queryClient, workspaceId, kind, value ?? ''),
    enabled: Boolean(workspaceId) && Boolean(value) && (options?.enabled ?? true),
  })
}

export interface WorkspaceFileLookups {
  /** Each resolved value's file; a value still loading or resolving to nothing is absent. */
  byValue: ReadonlyMap<string, WorkspaceFileRecord>
  /** True while any value is still on its first load. */
  isPending: boolean
}

function combineLookups(
  values: readonly string[],
  results: { data: WorkspaceFileRecord | null | undefined; isPending: boolean }[]
): WorkspaceFileLookups {
  const byValue = new Map<string, WorkspaceFileRecord>()
  let isPending = false
  results.forEach((result, index) => {
    if (result.data) byValue.set(values[index], result.data)
    if (result.isPending) isPending = true
  })
  return { byValue, isPending }
}

/**
 * Many files by id, storage key, or reference, sent as batched lookups and cached per value.
 * `values` must keep its identity while unchanged (memoize it), or the result is rebuilt each render.
 */
export function useWorkspaceFileLookups(
  workspaceId: string,
  kind: WorkspaceFileLookupKind,
  values: readonly string[],
  options?: { enabled?: boolean }
): WorkspaceFileLookups {
  const queryClient = useQueryClient()
  const enabled = Boolean(workspaceId) && (options?.enabled ?? true)
  /** Stable while `values` is, so the combined result keeps its identity between renders. */
  const combine = useCallback(
    (results: { data: WorkspaceFileRecord | null | undefined; isPending: boolean }[]) =>
      combineLookups(values, results),
    [values]
  )
  return useQueries({
    queries: values.map((value) => ({
      ...getWorkspaceFileLookupQueryOptions(queryClient, workspaceId, kind, value),
      enabled,
    })),
    combine,
  })
}

const SELECTION_NAME_CANDIDATE_LIMIT = 50

export interface WorkspaceFileSelectionCandidates {
  /** Every live file a selection could resolve to under `findSelectedWorkspaceFile`'s rules. */
  candidates: WorkspaceFileRecord[]
  /** True while any selection's candidates are still on their first load. */
  isPending: boolean
}

/**
 * The live files persisted picker selections can resolve to, without the workspace's list: each
 * selection's file by id, or — for older values — by storage key (stated, or read off the serve
 * path), and for the oldest, name-only shape, every file whose name contains that name, so
 * `findSelectedWorkspaceFile` can still refuse a name two files share.
 */
export function useWorkspaceFileSelectionCandidates(
  workspaceId: string,
  selections: readonly WorkspaceFileSelection[],
  options?: { enabled?: boolean }
): WorkspaceFileSelectionCandidates {
  const { ids, keys, names } = useMemo(() => {
    const ids = new Set<string>()
    const keys = new Set<string>()
    const names = new Set<string>()
    for (const selection of selections) {
      if (selection.id) ids.add(selection.id)
      else if (selection.key) keys.add(selection.key)
      else if (selection.path) keys.add(extractStorageKey(selection.path))
      else if (selection.name.trim()) names.add(selection.name.trim())
    }
    return { ids: [...ids], keys: [...keys], names: [...names] }
  }, [selections])
  const enabled = Boolean(workspaceId) && (options?.enabled ?? true)
  const byId = useWorkspaceFileLookups(workspaceId, 'id', ids, { enabled })
  const byKey = useWorkspaceFileLookups(workspaceId, 'key', keys, { enabled })
  const byName = useQueries({
    queries: names.map((name) => ({
      ...getWorkspaceFileSearchQueryOptions(workspaceId, {
        q: name,
        limit: SELECTION_NAME_CANDIDATE_LIMIT,
      }),
      enabled,
    })),
    combine: combineSearches,
  })
  /** Distinct by id: a file two reads found is one candidate, or a unique name reads as shared. */
  const candidates = useMemo(
    () => [
      ...new Map(
        [...byId.byValue.values(), ...byKey.byValue.values(), ...byName.files].map((file) => [
          file.id,
          file,
        ])
      ).values(),
    ],
    [byId.byValue, byKey.byValue, byName.files]
  )
  return {
    candidates,
    isPending: byId.isPending || byKey.isPending || byName.isPending,
  }
}

function combineSearches(
  results: { data: WorkspaceFileRecord[] | undefined; isPending: boolean }[]
): { files: WorkspaceFileRecord[]; isPending: boolean } {
  return {
    files: results.flatMap((result) => result.data ?? []),
    isPending: results.some((result) => result.isPending),
  }
}

/** The file's record, or `null` once no live file has that id (deleted, or never existed). */
async function fetchWorkspaceFileRecord(
  workspaceId: string,
  fileId: string,
  signal?: AbortSignal
): Promise<WorkspaceFileRecord | null> {
  try {
    const result = await requestJson(readWorkspaceFileContract, {
      params: { id: workspaceId, fileId },
      signal,
    })
    return result.file
  } catch (error) {
    if (isApiClientError(error) && error.status === 404) return null
    throw error
  }
}

/**
 * Shared options for one file's canonical record — including addressed chat uploads, which no
 * listing returns. Starts from the freshest copy any cached list, search, or lookup of the
 * workspace already holds, so opening a file from a list costs no request until that copy ages.
 */
export function getWorkspaceFileRecordQueryOptions(
  queryClient: QueryClient,
  workspaceId: string,
  fileId: string
) {
  const cached = () =>
    findCachedWorkspaceFile(queryClient, workspaceId, (file) => file.id === fileId)
  return {
    queryKey: workspaceFilesKeys.record(workspaceId, fileId),
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      fetchWorkspaceFileRecord(workspaceId, fileId, signal),
    staleTime: WORKSPACE_FILE_RECORD_STALE_TIME,
    initialData: () => cached()?.file,
    initialDataUpdatedAt: () => cached()?.updatedAt,
    retry: false,
  }
}

/**
 * One live file's record by id. `data` is `null` once the file is gone — a 404 is an answer, not
 * a failure, so a file deleted while open does not keep showing the record it was opened from.
 */
export function useWorkspaceFileRecord(
  workspaceId: string,
  fileId: string,
  options?: { enabled?: boolean }
) {
  const queryClient = useQueryClient()
  return useQuery({
    ...getWorkspaceFileRecordQueryOptions(queryClient, workspaceId, fileId),
    enabled: Boolean(workspaceId) && Boolean(fileId) && (options?.enabled ?? true),
  })
}

/**
 * Back the file content source's image-dimension capability with workspace file metadata. Each
 * embedded image is resolved by the storage key or file id its `src` carries — from any cached
 * read of the file, else one batched lookup — so a stored image reserves its box before it
 * downloads without the workspace's whole file list. The adapter takes a new identity whenever
 * a lookup of this workspace lands, which re-runs the node views' dimension reads: on a cold
 * direct file-view load the first read misses and the second, once the lookup resolves, hits.
 *
 * Persists the browser's measured dimensions when they're absent or disagree with what's stored —
 * an overwrite, so a stale value (left over after a content swap, or a non-EXIF-corrected one)
 * self-corrects rather than sticking. The write is fire-and-forget and de-duped (an exact-match
 * cache check plus mismatch-only reporting from the caller), so it never storms, never blocks
 * render, and never touches the collaborative document. `options.enabled` turns it off for
 * callers that supply their own content source (the public share page, whose `workspaceId` is
 * a share token that would 404).
 */
export function useWorkspaceImageDimensionsAdapter(
  workspaceId: string,
  options?: { enabled?: boolean }
): ImageDimensionsSource {
  const queryClient = useQueryClient()
  const enabled = Boolean(workspaceId) && (options?.enabled ?? true)
  const versionRef = useRef(0)
  const subscribe = useCallback(
    (onChange: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type === 'updated' &&
          event.action.type === 'success' &&
          event.query.queryKey[1] === 'lookup' &&
          event.query.queryKey[2] === workspaceId
        ) {
          versionRef.current += 1
          onChange()
        }
      }),
    [queryClient, workspaceId]
  )
  const version = useSyncExternalStore(
    subscribe,
    () => versionRef.current,
    () => 0
  )

  return useMemo<ImageDimensionsSource>(() => {
    /** The cached record for `src`, warming its lookup (outside render) on a miss. */
    const findRecord = (src: string | undefined): WorkspaceFileRecord | undefined => {
      const ref = enabled && src ? extractEmbeddedFileRef(src) : null
      if (!ref) return undefined
      const [kind, value] =
        'key' in ref ? (['key', ref.key] as const) : (['id', ref.fileId] as const)
      const lookup = getWorkspaceFileLookupQueryOptions(queryClient, workspaceId, kind, value)
      const resolved = queryClient.getQueryData<WorkspaceFileRecord | null>(lookup.queryKey)
      if (resolved !== undefined) return resolved ?? undefined
      const cached = lookup.initialData?.()
      if (cached) return cached
      queueMicrotask(() => void queryClient.prefetchQuery(lookup))
      return undefined
    }
    return {
      getImageDimensions: (src) => {
        const record = findRecord(src)
        return record?.width != null && record.height != null
          ? { width: record.width, height: record.height }
          : null
      },
      reportImageDimensions: (src, dimensions) => {
        const record = findRecord(src)
        // Skip when the file isn't one we can key (external/unlisted), or the cache already holds exactly
        // these dimensions. We do NOT skip merely because SOME dimensions are stored — they may be stale
        // (post content-swap / EXIF), and the caller only reports the browser's authoritative measurement
        // on a real mismatch, so we overwrite to self-correct.
        if (!record || (record.width === dimensions.width && record.height === dimensions.height))
          return
        // Populate every cached read so this and sibling views reserve space immediately.
        updateCachedWorkspaceFile(queryClient, workspaceId, record.id, (entry) => ({
          ...entry,
          ...dimensions,
        }))
        void requestJson(updateWorkspaceFileDimensionsContract, {
          params: { id: workspaceId, fileId: record.id },
          // Send the key we measured against; the server rejects the write if the row's content (key) has
          // since changed, so a stale in-flight PATCH for replaced bytes can't persist the old size.
          body: { key: record.key, ...dimensions },
        })
          .then((response) => {
            // The guard rejected the write because the file's content (key) changed since we measured —
            // our optimistic patch is now for superseded bytes, so refetch to reconcile the cache with the
            // new content (its real size is persisted when the replaced image next loads). Do NOT re-send
            // this measurement: it's of the old bytes and would write the wrong size under the new key.
            if (!response.success) void invalidateWorkspaceFileReads(queryClient, workspaceId)
          })
          // A transport error / 403 for a read-only member leaves the optimistic value in place: the
          // measurement is the real displayed size, correct whether or not it persisted; a later
          // refetch reconciles it.
          .catch(() => {})
      },
    }
    // `version` is the dependency that matters: a new identity is what re-runs the node views' reads.
  }, [enabled, queryClient, workspaceId, version])
}

/**
 * A read that addressed a storage object the file no longer points at.
 *
 * A workspace file's bytes are rewritten under a NEW storage key on every content update, and the
 * serve route answers only for the key the file currently points at (a superseded object is either
 * deleted or kept as a version reachable through the version API), so a 404 from a content read means
 * "the key you are holding has been replaced", not "the server is broken" — the serve route says as
 * much and logs it at `info`. Distinguished from a transport failure so {@link useStaleKeyRecovery}
 * can re-resolve the record instead of surfacing a dead end.
 */
class StaleStorageKeyError extends Error {
  constructor() {
    super('File content is no longer at the requested storage key')
    this.name = 'StaleStorageKeyError'
  }
}

/** The mounted metadata reads of a workspace — whichever one handed the reader its storage key. */
function activeWorkspaceFileReads(workspaceId: string) {
  return { ...workspaceFileMetadataFilter(workspaceId), type: 'active' as const }
}

/**
 * Re-resolve a workspace's file records after a read found its storage key superseded.
 *
 * The key a content read addresses comes from a cached record — the file's own, or the list,
 * search, or lookup the reader opened it from — and nothing invalidates those when a write rotates
 * the key: the collaborative relay projects an open document back to markdown every few seconds,
 * entirely server-side, so an open tab's key can be replaced many times over without a single
 * client-visible event. Recovering on the 404 makes the rotation cost one refetch of the mounted
 * reads instead of stranding the reader on a dead key until a full reload.
 *
 * Re-reads the RECORD, never the failed query: the refetched record either hands back a new key —
 * which re-keys the read onto a fresh cache entry that fetches once — or the same one, in which case
 * nothing refetches and the failure stands. That asymmetry is what makes this loop-proof, and it is why
 * a genuinely deleted file settles instead of retrying: its record stops resolving.
 *
 * Both details below exist because this runs from inside the failing read's own `queryFn`, and each was
 * measured: without them the recovery is requested and no fetch happens at all, so the reader is left
 * on the dead key showing a failure until something unrelated (a window focus, another consumer)
 * happens to re-resolve the record.
 */
function useStaleKeyRecovery(workspaceId: string): (error: unknown) => void {
  const queryClient = useQueryClient()
  return useCallback(
    (error: unknown) => {
      if (!workspaceId || !(error instanceof StaleStorageKeyError)) return
      // Off this fetch's own cycle (one microtask): a refetch asked for from inside a `queryFn` — where
      // this catch sits — is dropped by react-query, silently. This is what turned "one extra request"
      // into "no recovery at all".
      //
      // `cancelRefetch` because a re-resolution has to OBSERVE the rotation: a record read already in
      // flight was started before it, so it can only hand back the key we already know is dead.
      void Promise.resolve().then(() =>
        queryClient.refetchQueries(activeWorkspaceFileReads(workspaceId), { cancelRefetch: true })
      )
    },
    [queryClient, workspaceId]
  )
}

/**
 * Fetch file content as text via a content-source URL
 */
async function fetchWorkspaceFileContent(url: string, signal?: AbortSignal): Promise<string> {
  // boundary-raw-fetch: binary/text download, response is not JSON
  const response = await fetch(url, { signal, cache: 'no-store' })

  if (response.status === 404) throw new StaleStorageKeyError()
  if (!response.ok) {
    throw new Error('Failed to fetch file content')
  }

  return readFileText(response)
}

/**
 * Hook to fetch workspace file content as text.
 * `key` (the storage object key) is forwarded into the query key factory so that a new
 * storage key (e.g. after a file is re-uploaded) correctly busts the cache.
 *
 * `refetchInterval` lets a caller poll while waiting for the server content to advance — the
 * editor's post-stream reconcile (see `use-editable-file-content.ts`) exits only when a fetch
 * returns content that moved past its baseline, and would otherwise wedge read-only forever if
 * its single refetch raced the agent's write. The function form is re-evaluated by react-query
 * after every fetch and options pass, so a condition read through a ref stops the polling as soon
 * as it flips — no re-render required.
 *
 * `refetchOnWindowFocus` is how an out-of-band edit reaches a tab that was left open, so it defaults
 * on. Pass `false` where a server-side owner holds the file's durability — the collaborative relay
 * projects the live document to markdown itself, and delivers external writes into that document as
 * CRDT merges — because there the durable bytes are strictly behind what the editor already shows,
 * and re-reading them only chases a storage key the relay's last save already replaced.
 */
export function useWorkspaceFileContent(
  workspaceId: string,
  fileId: string,
  key: string,
  raw?: boolean,
  options?: {
    refetchInterval?: number | false | (() => number | false)
    refetchOnWindowFocus?: boolean
  }
): WorkspaceFileContentResult {
  const source = useFileContentSource()
  const recoverStaleKey = useStaleKeyRecovery(workspaceId)
  const query = useQuery({
    queryKey: workspaceFilesKeys.content(workspaceId, fileId, raw ? 'raw' : 'text', key),
    queryFn: async ({ signal }) => {
      try {
        return await fetchWorkspaceFileContent(source.buildUrl(key, { raw, bust: true }), signal)
      } catch (error) {
        recoverStaleKey(error)
        throw error
      }
    },
    enabled: !!workspaceId && !!fileId && !!key,
    staleTime: WORKSPACE_FILE_CONTENT_STALE_TIME,
    retry: (failureCount, error) => failureCount < 1 && !(error instanceof FileTextSizeError),
    refetchOnWindowFocus: options?.refetchOnWindowFocus === false ? false : 'always',
    refetchInterval: options?.refetchInterval ?? false,
  })
  return {
    data: query.data,
    ...useStaleKeyRecoveryState(workspaceId, query.isLoading, query.error),
  }
}

export interface WorkspaceFileContentResult {
  data: string | undefined
  /** True while there is nothing to show yet — including the re-resolution window below. */
  isLoading: boolean
  /** The failure worth showing the reader, or `null` while the address is still being re-resolved. */
  error: Error | null
}

/**
 * Present a superseded storage key as STILL LOADING rather than as a failure.
 *
 * A stale key is not a dead end and is not the reader's problem: the object moved, and the 404 has
 * already triggered {@link useStaleKeyRecovery}, which re-resolves the record — the moment a new key
 * arrives the read is re-keyed onto a fresh cache entry and fetches again. Painting "Failed to load
 * file content" in that window reports a failure the surface is actively recovering from, and the
 * content lands a few hundred milliseconds later, so the message is gone before it can be acted on.
 *
 * The window is bounded by a FACT, never a timer: the re-resolution is in flight. If the refetched
 * record hands back the same key — the object is genuinely gone, not moved — the recovery ends, the
 * error surfaces, and the reader sees a real failure.
 */
function useStaleKeyRecoveryState(
  workspaceId: string,
  isLoading: boolean,
  error: unknown
): { isLoading: boolean; error: Error | null } {
  const resolvingRecord = useIsFetching(workspaceFileMetadataFilter(workspaceId))
  const recovering = error instanceof StaleStorageKeyError && resolvingRecord > 0
  return {
    isLoading: isLoading || recovering,
    error: recovering ? null : ((error as Error) ?? null),
  }
}

/**
 * Thrown when the serve route returns 409 — a generated document (pptx/docx/pdf/
 * xlsx) whose source is still being written/compiled. Distinct from a real fetch
 * failure so the binary query can keep retrying (and the preview keeps showing
 * its loading state) until the compiled artifact is ready.
 */
export class DocNotReadyError extends Error {
  constructor() {
    super('Document is still being generated')
    this.name = 'DocNotReadyError'
  }
}

/**
 * Fetch compiled/binary file content via the serve URL.
 *
 * A `version` (the file record's `updatedAt`) lets the serve route mark the response
 * `immutable`, so the browser HTTP cache resolves re-opens and focus refetches with no
 * round trip. The route withholds that promise for bytes it resolved against OTHER
 * files — a doc compiled against its references, a page inlining its images — which the
 * same key can serve differently over time. An unversioned caller makes no immutability
 * claim at all and busts + bypasses the cache to always read fresh. A 409 means a
 * generated doc is still compiling — surfaced as {@link DocNotReadyError} so the query
 * keeps polling.
 */
async function fetchWorkspaceFileBinary(
  url: string,
  version: string | number | undefined,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const init: RequestInit = version != null ? { signal } : { signal, cache: 'no-store' }
  // boundary-raw-fetch: binary download consumed as ArrayBuffer
  const response = await fetch(url, init)
  if (response.status === 409) throw new DocNotReadyError()
  if (response.status === 404) throw new StaleStorageKeyError()
  if (!response.ok) throw new Error('Failed to fetch file content')
  return response.arrayBuffer()
}

/**
 * Hook to fetch workspace file content as binary (ArrayBuffer).
 * `key` (the storage object key) is forwarded into the query key factory so that a new
 * storage key (e.g. after a file is re-uploaded) correctly busts the cache.
 *
 * `options.version` is a content version (the record's `updatedAt`) folded into the
 * query key, and it is what lets the response be cached as immutable. A content write
 * rotates the storage key, so `key` alone would already re-key the query; `version`
 * additionally covers a recompile that leaves the key alone, and keys the first open to
 * the current content rather than a stale cached entry.
 */
export function useWorkspaceFileBinary(
  workspaceId: string,
  fileId: string,
  key: string,
  options?: { enabled?: boolean; version?: string | number }
) {
  const source = useFileContentSource()
  const recoverStaleKey = useStaleKeyRecovery(workspaceId)
  return useQuery({
    queryKey:
      options?.version != null
        ? [...workspaceFilesKeys.content(workspaceId, fileId, 'binary', key), options.version]
        : workspaceFilesKeys.content(workspaceId, fileId, 'binary', key),
    queryFn: async ({ signal }) => {
      try {
        return await fetchWorkspaceFileBinary(
          source.buildUrl(key, { version: options?.version, bust: true }),
          options?.version,
          signal
        )
      } catch (error) {
        recoverStaleKey(error)
        throw error
      }
    },
    // Callers gate this on a readiness signal (e.g. the file has committed
    // content) so we don't 409-poll the serve route for a generated doc whose
    // compiled artifact hasn't been written yet — the doc is fetched once, when
    // it's actually ready, instead of hammering the serve URL through generation.
    enabled: !!workspaceId && !!fileId && !!key && (options?.enabled ?? true),
    staleTime: WORKSPACE_FILE_BINARY_STALE_TIME,
    refetchOnWindowFocus: 'always',
    placeholderData: keepPreviousData,
    // While a generated doc is still compiling, serve returns 409. Poll (stay in
    // the loading state) until the artifact is ready instead of surfacing an
    // error. The artifact is written before the source commits, so a fresh serve
    // normally hits immediately; this only bridges S3 read-after-write lag and the
    // brief mid-generation window. Poll on a short jittered backoff (~0.6s rising
    // to ~2.5s, ~30s budget) so the common case recovers fast without hammering the
    // serve URL on the long tail. SSE content invalidation also re-fetches when the
    // file actually updates.
    retry: (failureCount, error) =>
      error instanceof DocNotReadyError ? failureCount < 14 : failureCount < 2,
    retryDelay: (failureCount, error) =>
      error instanceof DocNotReadyError
        ? backoffWithJitter(failureCount, null, { baseMs: 600, maxMs: 2500 })
        : Math.min(1000 * 2 ** failureCount, 5000),
  })
}

async function fetchCloudStorageConfigured(signal?: AbortSignal): Promise<boolean> {
  const data = await requestJson(fileStorageStatusContract, { signal })
  return data.cloudConfigured === true
}

/**
 * Whether S3 or Azure Blob is configured. Used by file uploads that need a
 * publicly fetchable HTTPS URL (e.g. Instagram publish).
 */
export function useCloudStorageConfigured(enabled = true) {
  return useQuery({
    queryKey: workspaceFilesKeys.cloudConfigured(),
    queryFn: ({ signal }) => fetchCloudStorageConfigured(signal),
    enabled,
    retry: false,
    staleTime: CLOUD_STORAGE_CONFIGURED_STALE_TIME,
    /**
     * Escapes the global `retryOnMount: false`: with an infinite `staleTime` and
     * `retry: false`, one transient error leaves this query errored for the tab's lifetime,
     * and the upload path reads "unknown" as "not configured" — disabling cloud uploads
     * until a full reload. The key is global, so navigation cannot recover it.
     */
    retryOnMount: true,
  })
}

/** Every metadata read of the workspace plus storage usage, after a write that changes files. */
function invalidateAfterFileWrite(queryClient: QueryClient, workspaceId: string) {
  return Promise.all([
    invalidateWorkspaceFileReads(queryClient, workspaceId),
    queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() }),
  ])
}

/**
 * Upload workspace file mutation
 */
interface UploadFileParams {
  workspaceId: string
  file: File
  folderId?: string | null
  onProgress?: (event: UploadProgressEvent) => void
  signal?: AbortSignal
  skipToast?: boolean
  skipInvalidation?: boolean
}

interface UploadFileResponse {
  success: boolean
  file: UserFile
}

async function uploadWorkspaceFile(
  workspaceId: string,
  file: File,
  folderId?: string | null,
  onProgress?: (event: UploadProgressEvent) => void,
  signal?: AbortSignal
): Promise<UploadFileResponse> {
  const uploaded = await uploadWorkspaceFileSession({
    workspaceId,
    folderId,
    file,
    onProgress,
    signal,
  })
  return {
    success: true,
    file: {
      id: uploaded.id,
      name: uploaded.name,
      size: uploaded.size,
      type: uploaded.type,
      url: `/api/files/serve/${encodeURIComponent(uploaded.key)}?context=workspace`,
      key: uploaded.key,
      context: 'workspace',
    },
  }
}

export function useUploadWorkspaceFile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ workspaceId, file, folderId, onProgress, signal }: UploadFileParams) =>
      uploadWorkspaceFile(workspaceId, file, folderId, onProgress, signal),
    onSettled: (_data, _error, variables) => {
      if (variables.skipInvalidation) return
      void invalidateAfterFileWrite(queryClient, variables.workspaceId)
    },
    onSuccess: (_data, variables) => {
      if (!variables.skipToast) {
        toast.success(`Uploaded "${variables.file.name}"`)
      }
    },
    onError: (error, variables) => {
      if (variables.signal?.aborted) return
      logger.error('Failed to upload file:', error)
      if (!variables.skipToast) {
        toast.error(`Failed to upload "${variables.file.name}": ${error.message}`, {
          duration: 5000,
        })
      }
    },
  })
}

type CreateWorkspaceFileParams = CreateWorkspaceFileBody & {
  workspaceId: string
}

export function useCreateWorkspaceFile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, ...body }: CreateWorkspaceFileParams) =>
      requestJson(createWorkspaceFileContract, {
        params: { id: workspaceId },
        body,
      }),
    onSettled: (_data, _error, variables) => {
      void invalidateAfterFileWrite(queryClient, variables.workspaceId)
    },
    onError: (error) => {
      logger.error('Failed to create file:', error)
    },
  })
}

/**
 * Update workspace file content mutation
 */
interface UpdateFileContentParams extends UpdateWorkspaceFileContentBody {
  workspaceId: string
  fileId: string
}

export function useUpdateWorkspaceFileContent() {
  const queryClient = useQueryClient()

  return useMutation({
    retry: false,
    mutationFn: async ({ workspaceId, fileId, ...body }: UpdateFileContentParams) => {
      return requestJson(updateWorkspaceFileContentContract, {
        params: { id: workspaceId, fileId },
        body,
      })
    },
    /** A lost response may follow a committed write; reconcile bytes and versions even after transport errors. */
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceFilesKeys.contentFile(variables.workspaceId, variables.fileId),
      })
      void invalidateAfterFileWrite(queryClient, variables.workspaceId)
    },
    onError: (error) => {
      logger.error('Failed to update file content:', error)
    },
  })
}

/** Reloads matching immutable bytes and their version before a user discards a conflicting draft. */
export function useReloadWorkspaceFileContent() {
  const queryClient = useQueryClient()
  const source = useFileContentSource()
  return useMutation({
    mutationFn: async ({
      workspaceId,
      fileId,
      raw,
    }: {
      workspaceId: string
      fileId: string
      raw: boolean
    }) => {
      const recordOptions = getWorkspaceFileRecordQueryOptions(queryClient, workspaceId, fileId)
      await queryClient.cancelQueries({ queryKey: recordOptions.queryKey })
      const file = await queryClient.fetchQuery({ ...recordOptions, staleTime: 0 })
      if (!file) throw new Error('File no longer exists')
      if (!file.contentUpdatedAt) throw new Error('The latest file version is unavailable')
      const content = await queryClient.fetchQuery({
        queryKey: workspaceFilesKeys.content(workspaceId, fileId, raw ? 'raw' : 'text', file.key),
        queryFn: ({ signal }) =>
          fetchWorkspaceFileContent(source.buildUrl(file.key, { raw, bust: true }), signal),
        staleTime: 0,
        retry: false,
      })
      return { file, content }
    },
    retry: (failureCount, error) => failureCount < 1 && error instanceof StaleStorageKeyError,
  })
}

/**
 * Rename a workspace file
 */
interface RenameFileParams {
  workspaceId: string
  fileId: string
  name: string
}

export function useRenameWorkspaceFile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, fileId, name }: RenameFileParams) =>
      requestJson(renameWorkspaceFileContract, {
        params: { id: workspaceId, fileId },
        body: { name },
      }),
    onMutate: async ({ workspaceId, fileId, name }) => {
      await queryClient.cancelQueries(workspaceFileMetadataFilter(workspaceId))
      const previous = snapshotWorkspaceFileReads(queryClient, workspaceId)
      updateCachedWorkspaceFile(queryClient, workspaceId, fileId, (file) => ({ ...file, name }))
      return { previous }
    },
    onError: (error, _variables, context) => {
      if (context) restoreWorkspaceFileReads(queryClient, context.previous)
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: (_data, _error, variables) => {
      void invalidateWorkspaceFileReads(queryClient, variables.workspaceId)
    },
  })
}

/**
 * Delete workspace file mutation
 */
interface DeleteFileParams {
  workspaceId: string
  fileId: string
}

export function useDeleteWorkspaceFile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, fileId }: DeleteFileParams) =>
      requestJson(deleteWorkspaceFileContract, {
        params: { id: workspaceId, fileId },
      }),
    onMutate: async ({ workspaceId, fileId }) => {
      await queryClient.cancelQueries(workspaceFileMetadataFilter(workspaceId))
      const previous = snapshotWorkspaceFileReads(queryClient, workspaceId)
      updateCachedWorkspaceFile(queryClient, workspaceId, fileId, () => null)
      return { previous }
    },
    onError: (error, _variables, context) => {
      if (context) restoreWorkspaceFileReads(queryClient, context.previous)
      logger.error('Failed to delete file')
      toast.error(toError(error).message)
    },
    onSuccess: () => {
      toast.success('File moved to trash')
    },
    onSettled: (_data, _error, variables) => {
      void invalidateAfterFileWrite(queryClient, variables.workspaceId)
      queryClient.removeQueries({
        queryKey: workspaceFilesKeys.contentFile(variables.workspaceId, variables.fileId),
      })
    },
  })
}

export function useRestoreWorkspaceFile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, fileId }: { workspaceId: string; fileId: string }) =>
      requestJson(restoreWorkspaceFileContract, {
        params: { id: workspaceId, fileId },
      }),
    onSuccess: () => {
      toast.success('File restored')
    },
    onError: (err) => {
      toast.error(toError(err).message)
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: recentlyDeletedKeys.lists() })
      void invalidateAfterFileWrite(queryClient, variables.workspaceId)
    },
  })
}
