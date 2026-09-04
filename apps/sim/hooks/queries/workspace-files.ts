import { useCallback, useMemo } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { backoffWithJitter } from '@sim/utils/retry'
import {
  keepPreviousData,
  useIsFetching,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { fileStorageStatusContract } from '@/lib/api/contracts/storage-transfer'
import {
  type CreateWorkspaceFileBody,
  createWorkspaceFileContract,
  deleteWorkspaceFileContract,
  listWorkspaceFilesContract,
  renameWorkspaceFileContract,
  restoreWorkspaceFileContract,
  type UpdateWorkspaceFileContentBody,
  updateWorkspaceFileContentContract,
  updateWorkspaceFileDimensionsContract,
} from '@/lib/api/contracts/workspace-files'
import { uploadWorkspaceFileSession } from '@/lib/uploads/client/session-upload'
import type { UploadProgressEvent } from '@/lib/uploads/client/types'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import type { UserFile } from '@/executor/types'
import { findWorkspaceFileBySrc } from '@/hooks/queries/utils/find-workspace-file-by-src'
import { type ImageDimensionsSource, useFileContentSource } from '@/hooks/use-file-content-source'

const logger = createLogger('WorkspaceFilesQuery')

type WorkspaceFileQueryScope = 'active' | 'archived'

/**
 * Query key factories for workspace files
 */
export const workspaceFilesKeys = {
  all: ['workspaceFiles'] as const,
  lists: () => [...workspaceFilesKeys.all, 'list'] as const,
  workspaceLists: (workspaceId: string) => [...workspaceFilesKeys.lists(), workspaceId] as const,
  list: (workspaceId: string, scope: WorkspaceFileQueryScope = 'active') =>
    [...workspaceFilesKeys.workspaceLists(workspaceId), scope] as const,
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

export const WORKSPACE_FILES_LIST_STALE_TIME = 30 * 1000
export const WORKSPACE_FILE_CONTENT_STALE_TIME = 30 * 1000
export const WORKSPACE_FILE_BINARY_STALE_TIME = 30 * 1000
export const WORKSPACE_STORAGE_INFO_STALE_TIME = 60 * 1000
/** Cloud storage (S3/Blob) is env-driven and does not change at runtime. */
export const CLOUD_STORAGE_CONFIGURED_STALE_TIME = Number.POSITIVE_INFINITY

/**
 * Hook to fetch a single workspace file record by ID.
 * Shares the `list(workspaceId, 'active')` query key with {@link useWorkspaceFiles} so no extra
 * network request is made when the list is already cached (warm path).
 * On a cold path (e.g. direct navigation to a file URL), this fetches the full active file list
 * for the workspace and selects the matching record via `select`.
 */
export function useWorkspaceFileRecord(workspaceId: string, fileId: string) {
  return useQuery({
    queryKey: workspaceFilesKeys.list(workspaceId, 'active'),
    queryFn: ({ signal }) => fetchWorkspaceFiles(workspaceId, 'active', signal),
    enabled: !!workspaceId && !!fileId,
    staleTime: WORKSPACE_FILES_LIST_STALE_TIME,
    select: (files) => files.find((f) => f.id === fileId) ?? null,
  })
}

/**
 * Fetch workspace files from API
 */
async function fetchWorkspaceFiles(
  workspaceId: string,
  scope: WorkspaceFileQueryScope = 'active',
  signal?: AbortSignal
): Promise<WorkspaceFileRecord[]> {
  const data = await requestJson(listWorkspaceFilesContract, {
    params: { id: workspaceId },
    query: { scope },
    signal,
  })
  return data.success ? data.files : []
}

/**
 * Shared options for the workspace-file list, so an imperative caller can
 * `fetchQuery` the same cache entry {@link useWorkspaceFiles} populates instead
 * of refetching by key and reading the result back out of the cache.
 */
export function getWorkspaceFilesQueryOptions(
  workspaceId: string,
  scope: WorkspaceFileQueryScope = 'active'
) {
  return {
    queryKey: workspaceFilesKeys.list(workspaceId, scope),
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      fetchWorkspaceFiles(workspaceId, scope, signal),
    staleTime: WORKSPACE_FILES_LIST_STALE_TIME, // 30 seconds - files can change frequently
  }
}

/**
 * Hook to fetch workspace files
 */
export function useWorkspaceFiles(
  workspaceId: string,
  scope: WorkspaceFileQueryScope = 'active',
  options?: { enabled?: boolean }
) {
  return useQuery({
    ...getWorkspaceFilesQueryOptions(workspaceId, scope),
    enabled: !!workspaceId && (options?.enabled ?? true),
    placeholderData: keepPreviousData, // Show cached data immediately
  })
}

/**
 * Back the file content source's image-dimension capability with workspace file metadata. Subscribes to
 * the active file list ({@link useWorkspaceFiles}) and reads each image's stored intrinsic dimensions from
 * it, so a stored image reserves its box before it downloads. A reactive read (not a one-shot
 * `getQueryData`), so it also works on a cold direct file-view load where the list isn't cached until after
 * the image first renders: the subscription re-runs the node view's dimension read once the list resolves.
 * Persists the browser's measured dimensions when they're absent or disagree with what's stored — an
 * overwrite, so a stale value (left over after a content swap, or a non-EXIF-corrected one) self-corrects
 * rather than sticking. The write is fire-and-forget and de-duped (an exact-match cache check plus
 * mismatch-only reporting from the caller), so it never storms, never blocks render, and never touches the
 * collaborative document. `options.enabled` turns the subscription off for callers that supply their own
 * content source (the public share page, whose `workspaceId` is a share token that would 404).
 */
export function useWorkspaceImageDimensionsAdapter(
  workspaceId: string,
  options?: { enabled?: boolean }
): ImageDimensionsSource {
  const queryClient = useQueryClient()
  const { data: files } = useWorkspaceFiles(workspaceId, 'active', options)
  return useMemo<ImageDimensionsSource>(() => {
    const listKey = workspaceFilesKeys.list(workspaceId, 'active')
    const findRecord = (src: string | undefined): WorkspaceFileRecord | undefined =>
      findWorkspaceFileBySrc(files, src)
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
        // Populate the cache so this and sibling views reserve space immediately.
        queryClient.setQueryData<WorkspaceFileRecord[]>(listKey, (previous) =>
          previous?.map((entry) => (entry.id === record.id ? { ...entry, ...dimensions } : entry))
        )
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
            if (!response.success) void queryClient.invalidateQueries({ queryKey: listKey })
          })
          // A transport error / 403 for a read-only member leaves the optimistic value in place: the
          // measurement is the real displayed size, correct whether or not it persisted; a later list
          // refetch reconciles it.
          .catch(() => {})
      },
    }
  }, [files, queryClient, workspaceId])
}

/**
 * A read that addressed a storage object the file no longer points at.
 *
 * A workspace file's bytes are rewritten under a NEW storage key on every content update and the
 * superseded object is deleted (`updateWorkspaceFileContent`), so a 404 from a content read means
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

/**
 * Re-resolve a workspace's file records after a read found its storage key superseded.
 *
 * The key a content read addresses comes from the cached file list, and nothing invalidates that
 * list when a write rotates the key — the collaborative relay projects an open document back to
 * markdown every few seconds, entirely server-side, so an open tab's key can be replaced many times
 * over without a single client-visible event. Recovering on the 404 makes the rotation cost exactly
 * one request instead of stranding the reader on a dead key until a full reload.
 *
 * Re-reads the RECORD, never the failed query: the refetched list either hands back a new key — which
 * re-keys the read onto a fresh cache entry that fetches once — or the same one, in which case nothing
 * refetches and the failure stands. That asymmetry is what makes this loop-proof, and it is why a
 * genuinely deleted file settles instead of retrying: the list simply stops containing it.
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
        queryClient.refetchQueries(
          { queryKey: workspaceFilesKeys.workspaceLists(workspaceId) },
          { cancelRefetch: true }
        )
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

  return response.text()
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
  const resolvingRecord = useIsFetching({
    queryKey: workspaceFilesKeys.workspaceLists(workspaceId),
  })
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
 * A `version` (the file record's `updatedAt`) makes the URL content-immutable: the
 * serve route marks versioned responses `immutable`, so the browser HTTP cache
 * resolves re-opens and focus refetches with no round trip. Generated docs are
 * edited in place (same storage key), so an unversioned caller cannot assume
 * immutability and instead busts + bypasses the cache to always read fresh. A 409
 * means a generated doc is still compiling — surfaced as {@link DocNotReadyError}
 * so the query keeps polling.
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
 * query key. Generated docs are edited IN PLACE — `edit_content` keeps the SAME
 * storage key — so without a version the cache is never busted and the open
 * preview keeps showing the stale binary after a regenerate. Versioning the key
 * makes the preview refetch whenever the file's content changes (and on first
 * open, keyed to the current content rather than a stale cached entry).
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
      queryClient.invalidateQueries({
        queryKey: workspaceFilesKeys.workspaceLists(variables.workspaceId),
      })
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
    },
    onSuccess: (_data, variables) => {
      if (!variables.skipToast) {
        toast.success(`Uploaded "${variables.file.name}"`)
      }
    },
    onError: (error, variables) => {
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
      queryClient.invalidateQueries({
        queryKey: workspaceFilesKeys.workspaceLists(variables.workspaceId),
      })
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
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
      queryClient.invalidateQueries({
        queryKey: workspaceFilesKeys.workspaceLists(variables.workspaceId),
      })
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
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
      await queryClient.cancelQueries({ queryKey: workspaceFilesKeys.workspaceLists(workspaceId) })
      const files = await queryClient.fetchQuery({
        ...getWorkspaceFilesQueryOptions(workspaceId),
        staleTime: 0,
      })
      const file = files.find((record) => record.id === fileId)
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
      await queryClient.cancelQueries({ queryKey: workspaceFilesKeys.workspaceLists(workspaceId) })
      const previous = queryClient.getQueryData<WorkspaceFileRecord[]>(
        workspaceFilesKeys.list(workspaceId, 'active')
      )
      if (previous) {
        queryClient.setQueryData<WorkspaceFileRecord[]>(
          workspaceFilesKeys.list(workspaceId, 'active'),
          previous.map((f) => (f.id === fileId ? { ...f, name } : f))
        )
      }
      return { previous }
    },
    onError: (error, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          workspaceFilesKeys.list(variables.workspaceId, 'active'),
          context.previous
        )
      }
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceFilesKeys.workspaceLists(variables.workspaceId),
      })
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
      await queryClient.cancelQueries({ queryKey: workspaceFilesKeys.workspaceLists(workspaceId) })

      const previousFiles = queryClient.getQueryData<WorkspaceFileRecord[]>(
        workspaceFilesKeys.list(workspaceId, 'active')
      )

      if (previousFiles) {
        queryClient.setQueryData<WorkspaceFileRecord[]>(
          workspaceFilesKeys.list(workspaceId, 'active'),
          previousFiles.filter((f) => f.id !== fileId)
        )
      }

      return { previousFiles }
    },
    onError: (_err, variables, context) => {
      if (context?.previousFiles) {
        queryClient.setQueryData(
          workspaceFilesKeys.list(variables.workspaceId, 'active'),
          context.previousFiles
        )
      }
      logger.error('Failed to delete file')
      toast.error(toError(_err).message)
    },
    onSuccess: () => {
      toast.success('File moved to trash')
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceFilesKeys.workspaceLists(variables.workspaceId),
      })
      queryClient.removeQueries({
        queryKey: workspaceFilesKeys.contentFile(variables.workspaceId, variables.fileId),
      })
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
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
      queryClient.invalidateQueries({
        queryKey: workspaceFilesKeys.workspaceLists(variables.workspaceId),
      })
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
    },
  })
}
