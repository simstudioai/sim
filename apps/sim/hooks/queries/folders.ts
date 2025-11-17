import { useEffect } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import { useFolderStore, type WorkflowFolder } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('FolderQueries')

export const folderKeys = {
  all: ['folders'] as const,
  lists: () => [...folderKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined) => [...folderKeys.lists(), workspaceId ?? ''] as const,
}

function mapFolder(folder: any): WorkflowFolder {
  return {
    id: folder.id,
    name: folder.name,
    userId: folder.userId,
    workspaceId: folder.workspaceId,
    parentId: folder.parentId,
    color: folder.color,
    isExpanded: folder.isExpanded,
    sortOrder: folder.sortOrder,
    createdAt: new Date(folder.createdAt),
    updatedAt: new Date(folder.updatedAt),
  }
}

async function fetchFolders(workspaceId: string): Promise<WorkflowFolder[]> {
  const response = await fetch(`/api/folders?workspaceId=${workspaceId}`)

  if (!response.ok) {
    throw new Error('Failed to fetch folders')
  }

  const { folders }: { folders: any[] } = await response.json()
  return folders.map(mapFolder)
}

export function useFolders(workspaceId?: string) {
  const setFolders = useFolderStore((state) => state.setFolders)

  const query = useQuery({
    queryKey: folderKeys.list(workspaceId),
    queryFn: () => fetchFolders(workspaceId as string),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    if (query.data) {
      setFolders(query.data)
    }
  }, [query.data, setFolders])

  return query
}

interface CreateFolderVariables {
  workspaceId: string
  name: string
  parentId?: string
  color?: string
}

interface UpdateFolderVariables {
  workspaceId: string
  id: string
  updates: Partial<Pick<WorkflowFolder, 'name' | 'parentId' | 'color' | 'sortOrder'>>
}

interface DeleteFolderVariables {
  workspaceId: string
  id: string
}

interface DuplicateFolderVariables {
  workspaceId: string
  id: string
  name: string
  parentId?: string | null
  color?: string
}

export function useCreateFolder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, ...payload }: CreateFolderVariables) => {
      const response = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, workspaceId }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to create folder')
      }

      const { folder } = await response.json()
      return mapFolder(folder)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: folderKeys.list(variables.workspaceId) })
    },
  })
}

export function useUpdateFolder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, id, updates }: UpdateFolderVariables) => {
      const response = await fetch(`/api/folders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to update folder')
      }

      const { folder } = await response.json()
      return mapFolder(folder)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: folderKeys.list(variables.workspaceId) })
    },
  })
}

export function useDeleteFolderMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId: _workspaceId, id }: DeleteFolderVariables) => {
      const response = await fetch(`/api/folders/${id}`, { method: 'DELETE' })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to delete folder')
      }

      return response.json()
    },
    onSuccess: async (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: folderKeys.list(variables.workspaceId) })
      try {
        await useWorkflowRegistry.getState().loadWorkflows(variables.workspaceId)
      } catch (error) {
        logger.error('Failed to reload workflows after folder delete', { error })
      }
    },
  })
}

export function useDuplicateFolderMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, workspaceId, name, parentId, color }: DuplicateFolderVariables) => {
      const response = await fetch(`/api/folders/${id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          name,
          parentId: parentId ?? null,
          color,
        }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to duplicate folder')
      }

      return response.json()
    },
    onSuccess: async (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: folderKeys.list(variables.workspaceId) })
      try {
        await useWorkflowRegistry.getState().loadWorkflows(variables.workspaceId)
      } catch (error) {
        logger.error('Failed to reload workflows after folder duplicate', { error })
      }
    },
  })
}
