import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

const logger = createLogger('WorkspaceFilesQuery')

/**
 * Query key factories for workspace files
 */
export const workspaceFilesKeys = {
  all: ['workspaceFiles'] as const,
  lists: () => [...workspaceFilesKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...workspaceFilesKeys.lists(), workspaceId] as const,
  storageInfo: (workspaceId: string) =>
    [...workspaceFilesKeys.all, 'storage', workspaceId] as const,
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
async function fetchWorkspaceFiles(workspaceId: string): Promise<WorkspaceFileRecord[]> {
  const response = await fetch(`/api/workspaces/${workspaceId}/files`)

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
    queryFn: () => fetchWorkspaceFiles(workspaceId),
    enabled: !!workspaceId,
    staleTime: 30 * 1000, // 30 seconds - files can change frequently
    placeholderData: keepPreviousData, // Show cached data immediately
  })
}

/**
 * Fetch storage info from API
 */
async function fetchStorageInfo(): Promise<StorageInfo | null> {
  const response = await fetch('/api/users/me/usage-limits')

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
    queryKey: ['storageInfo'],
    queryFn: fetchStorageInfo,
    enabled,
    retry: false, // Don't retry on 404
    staleTime: 60 * 1000, // 1 minute - storage info doesn't change often
    placeholderData: keepPreviousData,
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
      queryClient.invalidateQueries({ queryKey: ['storageInfo'] })
    },
    onError: (error) => {
      logger.error('Failed to upload file:', error)
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
      await queryClient.cancelQueries({ queryKey: workspaceFilesKeys.list(workspaceId) })
      await queryClient.cancelQueries({ queryKey: ['storageInfo'] })

      const previousFiles = queryClient.getQueryData<WorkspaceFileRecord[]>(
        workspaceFilesKeys.list(workspaceId)
      )
      const previousStorage = queryClient.getQueryData<StorageInfo>(['storageInfo'])

      if (previousFiles) {
        queryClient.setQueryData<WorkspaceFileRecord[]>(
          workspaceFilesKeys.list(workspaceId),
          previousFiles.filter((f) => f.id !== fileId)
        )
      }

      if (previousStorage) {
        const newUsedBytes = Math.max(0, previousStorage.usedBytes - fileSize)
        const newPercentUsed = (newUsedBytes / previousStorage.limitBytes) * 100
        queryClient.setQueryData<StorageInfo>(['storageInfo'], {
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
        queryClient.setQueryData(['storageInfo'], context.previousStorage)
      }
      logger.error('Failed to delete file')
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.list(variables.workspaceId) })
      queryClient.invalidateQueries({ queryKey: ['storageInfo'] })
    },
  })
}
