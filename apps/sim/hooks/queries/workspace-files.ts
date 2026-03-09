import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

const logger = createLogger('WorkspaceFilesQuery')

/**
 * Query key factories for workspace files
 */
export const workspaceFilesKeys = {
  all: ['workspaceFiles'] as const,
  lists: () => [...workspaceFilesKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...workspaceFilesKeys.lists(), workspaceId] as const,
  contents: () => [...workspaceFilesKeys.all, 'content'] as const,
  content: (workspaceId: string, fileId: string) =>
    [...workspaceFilesKeys.contents(), workspaceId, fileId] as const,
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
 * Fetch workspace files from API
 */
async function fetchWorkspaceFiles(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceFileRecord[]> {
  const response = await fetch(`/api/workspaces/${workspaceId}/files`, { signal })

  if (!response.ok) {
    throw new Error('Failed to fetch workspace files')
  }

  const data = await response.json()

  return data.success ? data.files : []
}

/**
 * Hook to fetch workspace files
 */
export function useWorkspaceFiles(workspaceId: string) {
  return useQuery({
    queryKey: workspaceFilesKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchWorkspaceFiles(workspaceId, signal),
    enabled: !!workspaceId,
    staleTime: 30 * 1000, // 30 seconds - files can change frequently
    placeholderData: keepPreviousData, // Show cached data immediately
  })
}

/**
 * Fetch file content as text via the serve URL
 */
async function fetchWorkspaceFileContent(key: string, signal?: AbortSignal): Promise<string> {
  const serveUrl = `/api/files/serve/${encodeURIComponent(key)}?context=workspace`
  const response = await fetch(serveUrl, { signal })

  if (!response.ok) {
    throw new Error('Failed to fetch file content')
  }

  return response.text()
}

/**
 * Hook to fetch workspace file content as text
 */
export function useWorkspaceFileContent(workspaceId: string, fileId: string, key: string) {
  return useQuery({
    queryKey: workspaceFilesKeys.content(workspaceId, fileId),
    queryFn: ({ signal }) => fetchWorkspaceFileContent(key, signal),
    enabled: !!workspaceId && !!fileId && !!key,
    staleTime: 30 * 1000,
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
    onSuccess: (_data, variables) => {
      // Invalidate files list to refetch
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.list(variables.workspaceId) })
      // Invalidate storage info to update usage
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
}

export function useUpdateWorkspaceFileContent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, fileId, content }: UpdateFileContentParams) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/files/${fileId}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Update failed')
      }

      return data
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceFilesKeys.content(variables.workspaceId, variables.fileId),
      })
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.list(variables.workspaceId) })
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
    },
    onError: (error) => {
      logger.error('Failed to update file content:', error)
    },
  })
}

/**
 * Delete workspace file mutation
 */
interface DeleteFileParams {
  workspaceId: string
  fileId: string
  fileSize: number
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
    onMutate: async ({ workspaceId, fileId, fileSize }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: workspaceFilesKeys.list(workspaceId) }),
        queryClient.cancelQueries({ queryKey: workspaceFilesKeys.storageInfo() }),
      ])

      const previousFiles = queryClient.getQueryData<WorkspaceFileRecord[]>(
        workspaceFilesKeys.list(workspaceId)
      )
      const previousStorage = queryClient.getQueryData<StorageInfo>(
        workspaceFilesKeys.storageInfo()
      )

      if (previousFiles) {
        queryClient.setQueryData<WorkspaceFileRecord[]>(
          workspaceFilesKeys.list(workspaceId),
          previousFiles.filter((f) => f.id !== fileId)
        )
      }

      if (previousStorage) {
        const newUsedBytes = Math.max(0, previousStorage.usedBytes - fileSize)
        const newPercentUsed = (newUsedBytes / previousStorage.limitBytes) * 100
        queryClient.setQueryData<StorageInfo>(workspaceFilesKeys.storageInfo(), {
          ...previousStorage,
          usedBytes: newUsedBytes,
          percentUsed: newPercentUsed,
        })
      }

      return { previousFiles, previousStorage }
    },
    onError: (_err, variables, context) => {
      if (context?.previousFiles) {
        queryClient.setQueryData(
          workspaceFilesKeys.list(variables.workspaceId),
          context.previousFiles
        )
      }
      if (context?.previousStorage) {
        queryClient.setQueryData(workspaceFilesKeys.storageInfo(), context.previousStorage)
      }
      logger.error('Failed to delete file')
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.list(variables.workspaceId) })
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
    },
  })
}
