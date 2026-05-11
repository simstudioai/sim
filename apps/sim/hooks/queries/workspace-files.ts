import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import { ApiClientError, isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { getUsageLimitsContract } from '@/lib/api/contracts/usage-limits'
import {
  deleteWorkspaceFileContract,
  listWorkspaceFilesContract,
  registerWorkspaceFileContract,
  renameWorkspaceFileContract,
  restoreWorkspaceFileContract,
  updateWorkspaceFileContentContract,
} from '@/lib/api/contracts/workspace-files'
import {
  DirectUploadError,
  runUploadStrategy,
  type UploadProgressEvent,
} from '@/lib/uploads/client/direct-upload'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import type { UserFile } from '@/executor/types'

const logger = createLogger('WorkspaceFilesQuery')

type WorkspaceFileQueryScope = 'active' | 'archived' | 'all'

/**
 * Query key factories for workspace files
 */
export const workspaceFilesKeys = {
  all: ['workspaceFiles'] as const,
  lists: () => [...workspaceFilesKeys.all, 'list'] as const,
  list: (workspaceId: string, scope: WorkspaceFileQueryScope = 'active') =>
    [...workspaceFilesKeys.lists(), workspaceId, scope] as const,
  contents: () => [...workspaceFilesKeys.all, 'content'] as const,
  contentFile: (workspaceId: string, fileId: string) =>
    [...workspaceFilesKeys.contents(), workspaceId, fileId] as const,
  content: (workspaceId: string, fileId: string, mode: 'text' | 'raw' | 'binary' = 'text') =>
    [...workspaceFilesKeys.contentFile(workspaceId, fileId), mode] as const,
  storageInfo: () => [...workspaceFilesKeys.all, 'storageInfo'] as const,
}

/**
 * Storage info type
 */
interface StorageInfo {
  usedBytes: number
  limitBytes: number
  percentUsed: number
  plan?: string
}

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
    staleTime: 30 * 1000,
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
 * Hook to fetch workspace files
 */
export function useWorkspaceFiles(workspaceId: string, scope: WorkspaceFileQueryScope = 'active') {
  return useQuery({
    queryKey: workspaceFilesKeys.list(workspaceId, scope),
    queryFn: ({ signal }) => fetchWorkspaceFiles(workspaceId, scope, signal),
    enabled: !!workspaceId,
    staleTime: 30 * 1000, // 30 seconds - files can change frequently
    placeholderData: keepPreviousData, // Show cached data immediately
  })
}

/**
 * Fetch file content as text via the serve URL
 */
async function fetchWorkspaceFileContent(
  key: string,
  signal?: AbortSignal,
  raw?: boolean
): Promise<string> {
  const serveUrl = `/api/files/serve/${encodeURIComponent(key)}?context=workspace&t=${Date.now()}${raw ? '&raw=1' : ''}`
  // boundary-raw-fetch: binary/text download, response is not JSON
  const response = await fetch(serveUrl, { signal, cache: 'no-store' })

  if (!response.ok) {
    throw new Error('Failed to fetch file content')
  }

  return response.text()
}

/**
 * Hook to fetch workspace file content as text.
 * `key` (the storage object key) is included in the query key so that a new
 * storage key (e.g. after a file is re-uploaded) correctly busts the cache.
 */
export function useWorkspaceFileContent(
  workspaceId: string,
  fileId: string,
  key: string,
  raw?: boolean
) {
  return useQuery({
    queryKey: [...workspaceFilesKeys.content(workspaceId, fileId, raw ? 'raw' : 'text'), key],
    queryFn: ({ signal }) => fetchWorkspaceFileContent(key, signal, raw),
    enabled: !!workspaceId && !!fileId && !!key,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: 'always',
  })
}

async function fetchWorkspaceFileBinary(key: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const serveUrl = `/api/files/serve/${encodeURIComponent(key)}?context=workspace&t=${Date.now()}`
  // boundary-raw-fetch: binary download consumed as ArrayBuffer
  const response = await fetch(serveUrl, { signal, cache: 'no-store' })
  if (!response.ok) throw new Error('Failed to fetch file content')
  return response.arrayBuffer()
}

/**
 * Hook to fetch workspace file content as binary (ArrayBuffer).
 * `key` (the storage object key) is included in the query key so that a new
 * storage key (e.g. after a file is re-uploaded) correctly busts the cache.
 */
export function useWorkspaceFileBinary(workspaceId: string, fileId: string, key: string) {
  return useQuery({
    queryKey: [...workspaceFilesKeys.content(workspaceId, fileId, 'binary'), key],
    queryFn: ({ signal }) => fetchWorkspaceFileBinary(key, signal),
    enabled: !!workspaceId && !!fileId && !!key,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: 'always',
  })
}

/**
 * Fetch storage info from API
 */
async function fetchStorageInfo(signal?: AbortSignal): Promise<StorageInfo | null> {
  try {
    const data = await requestJson(getUsageLimitsContract, { signal })

    if (data.success && data.storage) {
      return {
        usedBytes: data.storage.usedBytes,
        limitBytes: data.storage.limitBytes,
        percentUsed: data.storage.percentUsed,
        plan: data.usage?.plan || 'free',
      }
    }

    return null
  } catch (error) {
    if (isApiClientError(error) && error.status === 404) {
      return null
    }
    throw error
  }
}

/**
 * Hook to fetch storage info
 */
export function useStorageInfo(enabled = true) {
  return useQuery({
    queryKey: workspaceFilesKeys.storageInfo(),
    queryFn: ({ signal }) => fetchStorageInfo(signal),
    enabled,
    retry: false, // Don't retry on 404
    staleTime: 60 * 1000, // 1 minute - storage info doesn't change often
  })
}

/**
 * Upload workspace file mutation
 */
interface UploadFileParams {
  workspaceId: string
  file: File
  onProgress?: (event: UploadProgressEvent) => void
  signal?: AbortSignal
  skipToast?: boolean
  skipInvalidation?: boolean
}

interface UploadFileResponse {
  success: boolean
  file: UserFile
}

async function uploadViaApiFallback(
  workspaceId: string,
  file: File,
  signal?: AbortSignal
): Promise<UploadFileResponse> {
  const formData = new FormData()
  formData.append('file', file)

  // boundary-raw-fetch: multipart/form-data fallback upload, requestJson only supports JSON bodies
  const response = await fetch(`/api/workspaces/${workspaceId}/files`, {
    method: 'POST',
    body: formData,
    signal,
  })

  return parseUploadResponse(response, 'Upload failed')
}

async function parseUploadResponse(
  response: Response,
  fallbackMessage: string
): Promise<UploadFileResponse> {
  let data: { success?: boolean; error?: string; file?: UserFile } | null = null
  try {
    data = await response.json()
  } catch {}

  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `${fallbackMessage} (${response.status})`)
  }
  return data as UploadFileResponse
}

async function uploadWorkspaceFile(
  workspaceId: string,
  file: File,
  onProgress?: (event: UploadProgressEvent) => void,
  signal?: AbortSignal
): Promise<UploadFileResponse> {
  let result
  try {
    result = await runUploadStrategy({
      file,
      presignedEndpoint: `/api/workspaces/${workspaceId}/files/presigned`,
      workspaceId,
      context: 'workspace',
      onProgress,
      signal,
    })
  } catch (error) {
    if (error instanceof DirectUploadError && error.code === 'FALLBACK_REQUIRED') {
      return uploadViaApiFallback(workspaceId, file, signal)
    }
    throw error
  }

  const data = await registerWithRetry(workspaceId, result, signal)

  if (!data.success || !data.file) {
    throw new Error(data.error || 'Failed to register file')
  }
  return { success: true, file: data.file }
}

const REGISTER_MAX_ATTEMPTS = 3
const REGISTER_RETRY_DELAY_MS = 500

/**
 * Register the uploaded object with bounded retries. The server-side handler
 * is idempotent (existing-record short-circuit), so safely retrying handles
 * dropped responses that would otherwise orphan the object in storage.
 */
async function registerWithRetry(
  workspaceId: string,
  result: { key: string; name: string; contentType: string },
  signal?: AbortSignal
) {
  let lastError: unknown
  for (let attempt = 1; attempt <= REGISTER_MAX_ATTEMPTS; attempt++) {
    try {
      return await requestJson(registerWorkspaceFileContract, {
        params: { id: workspaceId },
        body: {
          key: result.key,
          name: result.name,
          contentType: result.contentType,
        },
        signal,
      })
    } catch (error) {
      lastError = error
      if (signal?.aborted) throw error
      const isTransient =
        !(error instanceof ApiClientError) || (error.status >= 500 && error.status < 600)
      if (!isTransient || attempt === REGISTER_MAX_ATTEMPTS) throw error
      await sleep(REGISTER_RETRY_DELAY_MS * attempt)
    }
  }
  throw lastError
}

export function useUploadWorkspaceFile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ workspaceId, file, onProgress, signal }: UploadFileParams) =>
      uploadWorkspaceFile(workspaceId, file, onProgress, signal),
    onSettled: (_data, _error, variables) => {
      if (variables.skipInvalidation) return
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.lists() })
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

/**
 * Update workspace file content mutation
 */
interface UpdateFileContentParams {
  workspaceId: string
  fileId: string
  content: string
  encoding?: 'base64' | 'utf-8'
}

export function useUpdateWorkspaceFileContent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, fileId, content, encoding }: UpdateFileContentParams) => {
      return requestJson(updateWorkspaceFileContentContract, {
        params: { id: workspaceId, fileId },
        body: encoding ? { content, encoding } : { content },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceFilesKeys.contentFile(variables.workspaceId, variables.fileId),
      })
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
    },
    onError: (error) => {
      logger.error('Failed to update file content:', error)
    },
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
    onError: (error) => {
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.lists() })
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
      await queryClient.cancelQueries({ queryKey: workspaceFilesKeys.lists() })

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
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.lists() })
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
    },
  })
}
