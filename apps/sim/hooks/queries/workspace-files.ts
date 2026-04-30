import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

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
export interface StorageInfo {
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
  const response = await fetch(`/api/workspaces/${workspaceId}/files?scope=${scope}`, { signal })

  if (!response.ok) {
    throw new Error('Failed to fetch workspace files')
  }

  const data = await response.json()

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
  const response = await fetch('/api/users/me/usage-limits', { signal })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error('Failed to fetch storage info')
  }

  const data = await response.json()

  if (data.success && data.storage) {
    return {
      usedBytes: data.storage.usedBytes,
      limitBytes: data.storage.limitBytes,
      percentUsed: data.storage.percentUsed,
      plan: data.usage?.plan || 'free',
    }
  }

  return null
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
}

export function useUploadWorkspaceFile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, file }: UploadFileParams) => {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`/api/workspaces/${workspaceId}/files`, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Upload failed')
      }

      return data
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
    },
    onError: (error) => {
      logger.error('Failed to upload file:', error)
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
      const response = await fetch(`/api/workspaces/${workspaceId}/files/${fileId}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(encoding ? { content, encoding } : { content }),
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Update failed')
      }

      return data
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
    mutationFn: async ({ workspaceId, fileId, name }: RenameFileParams) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/files/${fileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error((error as { error?: string }).error || 'Failed to rename file')
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Rename failed')
      }

      return data
    },
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
    mutationFn: async ({ workspaceId, fileId }: DeleteFileParams) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/files/${fileId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Delete failed')
      }

      return data
    },
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
    mutationFn: async ({ workspaceId, fileId }: { workspaceId: string; fileId: string }) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/files/${fileId}/restore`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to restore file')
      }
      return res.json()
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
    },
  })
}
