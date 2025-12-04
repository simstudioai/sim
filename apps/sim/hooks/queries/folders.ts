import { useEffect } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import { workflowKeys } from '@/hooks/queries/workflows'
import { useFolderStore, type WorkflowFolder } from '@/stores/folders/store'

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

interface CreateFolderContext {
  tempId: string
  previousFolders: Record<string, WorkflowFolder>
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
    onMutate: async (variables): Promise<CreateFolderContext> => {
      // Cancel any outgoing refetches to prevent race conditions
      await queryClient.cancelQueries({ queryKey: folderKeys.list(variables.workspaceId) })

      // Snapshot previous state for rollback
      const previousFolders = { ...useFolderStore.getState().folders }

      // Calculate max sortOrder to place new folder at the bottom
      const workspaceFolders = Object.values(previousFolders).filter(
        (f) =>
          f.workspaceId === variables.workspaceId && f.parentId === (variables.parentId || null)
      )
      const maxSortOrder = workspaceFolders.reduce((max, f) => Math.max(max, f.sortOrder), -1)

      const tempId = `temp-folder-${Date.now()}`

      // Optimistically add folder entry immediately at the bottom
      useFolderStore.setState((state) => ({
        folders: {
          ...state.folders,
          [tempId]: {
            id: tempId,
            name: variables.name,
            userId: '',
            workspaceId: variables.workspaceId,
            parentId: variables.parentId || null,
            color: variables.color || '#808080',
            isExpanded: false,
            sortOrder: maxSortOrder + 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      }))

      logger.info(`Added optimistic folder entry: ${tempId}`)
      return { tempId, previousFolders }
    },
    onSuccess: (data, _variables, context) => {
      logger.info(`Folder ${data.id} created successfully, replacing temp entry ${context.tempId}`)

      // Replace optimistic entry with real folder data
      useFolderStore.setState((state) => {
        const { [context.tempId]: _, ...remainingFolders } = state.folders
        return {
          folders: {
            ...remainingFolders,
            [data.id]: data,
          },
        }
      })
    },
    onError: (error: Error, _variables, context) => {
      logger.error('Failed to create folder:', error)

      // Rollback to previous state snapshot
      if (context?.previousFolders) {
        useFolderStore.setState({ folders: context.previousFolders })
        logger.info(`Rolled back to previous folders state`)
      }
    },
    onSettled: (_data, _error, variables) => {
      // Always invalidate to sync with server state
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
      queryClient.invalidateQueries({ queryKey: workflowKeys.list(variables.workspaceId) })
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
      queryClient.invalidateQueries({ queryKey: workflowKeys.list(variables.workspaceId) })
    },
  })
}
