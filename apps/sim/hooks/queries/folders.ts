import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createOptimisticMutationHandlers,
  generateTempId,
} from '@/hooks/queries/utils/optimistic-mutation'
import { workflowKeys } from '@/hooks/queries/workflows'
import { useFolderStore } from '@/stores/folders/store'
import type { WorkflowFolder } from '@/stores/folders/types'

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
  sortOrder?: number
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

/**
 * Creates optimistic mutation handlers for folder operations
 */
function createFolderMutationHandlers<TVariables extends { workspaceId: string }>(
  queryClient: ReturnType<typeof useQueryClient>,
  name: string,
  createOptimisticFolder: (
    variables: TVariables,
    tempId: string,
    previousFolders: Record<string, WorkflowFolder>
  ) => WorkflowFolder
) {
  return createOptimisticMutationHandlers<WorkflowFolder, TVariables, WorkflowFolder>(queryClient, {
    name,
    getQueryKey: (variables) => folderKeys.list(variables.workspaceId),
    getSnapshot: () => ({ ...useFolderStore.getState().folders }),
    generateTempId: () => generateTempId('temp-folder'),
    createOptimisticItem: (variables, tempId) => {
      const previousFolders = useFolderStore.getState().folders
      return createOptimisticFolder(variables, tempId, previousFolders)
    },
    applyOptimisticUpdate: (tempId, item) => {
      useFolderStore.setState((state) => ({
        folders: { ...state.folders, [tempId]: item },
      }))
    },
    replaceOptimisticEntry: (tempId, data) => {
      useFolderStore.setState((state) => {
        const { [tempId]: _, ...remainingFolders } = state.folders
        return {
          folders: {
            ...remainingFolders,
            [data.id]: data,
          },
        }
      })
    },
    rollback: (snapshot) => {
      useFolderStore.setState({ folders: snapshot })
    },
  })
}

/**
 * Calculates the next sort order for a folder in a given parent
 */
function getNextSortOrder(
  folders: Record<string, WorkflowFolder>,
  workspaceId: string,
  parentId: string | null | undefined
): number {
  const siblingFolders = Object.values(folders).filter(
    (f) => f.workspaceId === workspaceId && f.parentId === (parentId || null)
  )
  return siblingFolders.reduce((max, f) => Math.max(max, f.sortOrder), -1) + 1
}

export function useCreateFolder() {
  const queryClient = useQueryClient()

  const handlers = createFolderMutationHandlers<CreateFolderVariables>(
    queryClient,
    'CreateFolder',
    (variables, tempId, previousFolders) => ({
      id: tempId,
      name: variables.name,
      userId: '',
      workspaceId: variables.workspaceId,
      parentId: variables.parentId || null,
      color: variables.color || '#808080',
      isExpanded: false,
      sortOrder:
        variables.sortOrder ??
        getNextSortOrder(previousFolders, variables.workspaceId, variables.parentId),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  )

  return useMutation({
    mutationFn: async ({ workspaceId, sortOrder, ...payload }: CreateFolderVariables) => {
      const response = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, workspaceId, sortOrder }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to create folder')
      }

      const { folder } = await response.json()
      return mapFolder(folder)
    },
    ...handlers,
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

  const handlers = createFolderMutationHandlers<DuplicateFolderVariables>(
    queryClient,
    'DuplicateFolder',
    (variables, tempId, previousFolders) => {
      // Get source folder info if available
      const sourceFolder = previousFolders[variables.id]
      return {
        id: tempId,
        name: variables.name,
        userId: sourceFolder?.userId || '',
        workspaceId: variables.workspaceId,
        parentId: variables.parentId ?? sourceFolder?.parentId ?? null,
        color: variables.color || sourceFolder?.color || '#808080',
        isExpanded: false,
        sortOrder: getNextSortOrder(previousFolders, variables.workspaceId, variables.parentId),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    }
  )

  return useMutation({
    mutationFn: async ({
      id,
      workspaceId,
      name,
      parentId,
      color,
    }: DuplicateFolderVariables): Promise<WorkflowFolder> => {
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

      const data = await response.json()
      return mapFolder(data.folder || data)
    },
    ...handlers,
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: folderKeys.list(variables.workspaceId) })
      queryClient.invalidateQueries({ queryKey: workflowKeys.list(variables.workspaceId) })
    },
  })
}

interface ReorderFoldersVariables {
  workspaceId: string
  updates: Array<{
    id: string
    sortOrder: number
    parentId?: string | null
  }>
}

export function useReorderFolders() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (variables: ReorderFoldersVariables): Promise<void> => {
      const response = await fetch('/api/folders/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variables),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to reorder folders')
      }
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: folderKeys.list(variables.workspaceId) })

      const snapshot = { ...useFolderStore.getState().folders }

      useFolderStore.setState((state) => {
        const updated = { ...state.folders }
        for (const update of variables.updates) {
          if (updated[update.id]) {
            updated[update.id] = {
              ...updated[update.id],
              sortOrder: update.sortOrder,
              parentId:
                update.parentId !== undefined ? update.parentId : updated[update.id].parentId,
            }
          }
        }
        return { folders: updated }
      })

      return { snapshot }
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshot) {
        useFolderStore.setState({ folders: context.snapshot })
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: folderKeys.list(variables.workspaceId) })
    },
  })
}
