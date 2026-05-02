import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  createFolderContract,
  deleteFolderContract,
  duplicateFolderContract,
  type FolderApi,
  listFoldersContract,
  reorderFoldersContract,
  restoreFolderContract,
  updateFolderContract,
} from '@/lib/api/contracts'
import { getFolderMap } from '@/hooks/queries/utils/folder-cache'
import { type FolderQueryScope, folderKeys } from '@/hooks/queries/utils/folder-keys'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'
import {
  createOptimisticMutationHandlers,
  generateTempId,
} from '@/hooks/queries/utils/optimistic-mutation'
import { getTopInsertionSortOrder } from '@/hooks/queries/utils/top-insertion-sort-order'
import { getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import type { WorkflowFolder } from '@/stores/folders/types'

const logger = createLogger('FolderQueries')

function mapFolder(folder: FolderApi): WorkflowFolder {
  return {
    id: folder.id,
    name: folder.name,
    userId: folder.userId,
    workspaceId: folder.workspaceId,
    parentId: folder.parentId,
    color: folder.color ?? '#6B7280',
    isExpanded: folder.isExpanded,
    locked: folder.locked,
    sortOrder: folder.sortOrder,
    createdAt: new Date(folder.createdAt),
    updatedAt: new Date(folder.updatedAt),
    archivedAt: folder.archivedAt ? new Date(folder.archivedAt) : null,
  }
}

async function fetchFolders(
  workspaceId: string,
  scope: FolderQueryScope = 'active',
  signal?: AbortSignal
): Promise<WorkflowFolder[]> {
  const { folders } = await requestJson(listFoldersContract, {
    query: { workspaceId, scope },
    signal,
  })
  return folders.map(mapFolder)
}

export function useFolders(workspaceId?: string, options?: { scope?: FolderQueryScope }) {
  const scope = options?.scope ?? 'active'
  return useQuery({
    queryKey: folderKeys.list(workspaceId, scope),
    queryFn: ({ signal }) => fetchFolders(workspaceId as string, scope, signal),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  })
}

const selectFolderMap = (folders: WorkflowFolder[]): Record<string, WorkflowFolder> =>
  Object.fromEntries(folders.map((folder) => [folder.id, folder]))

export function useFolderMap(workspaceId?: string) {
  return useQuery({
    queryKey: folderKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchFolders(workspaceId as string, 'active', signal),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    select: selectFolderMap,
  })
}

interface CreateFolderVariables {
  workspaceId: string
  name: string
  parentId?: string
  color?: string
  sortOrder?: number
  id?: string
}

interface UpdateFolderVariables {
  workspaceId: string
  id: string
  updates: Partial<Pick<WorkflowFolder, 'name' | 'parentId' | 'color' | 'sortOrder' | 'locked'>>
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
  newId?: string
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
  ) => WorkflowFolder,
  customGenerateTempId?: (variables: TVariables) => string
) {
  return createOptimisticMutationHandlers<WorkflowFolder, TVariables, WorkflowFolder>(queryClient, {
    name,
    getQueryKey: (variables) => folderKeys.list(variables.workspaceId),
    getSnapshot: (variables) => ({ ...getFolderMap(variables.workspaceId) }),
    generateTempId: customGenerateTempId ?? (() => generateTempId('temp-folder')),
    createOptimisticItem: (variables, tempId) => {
      const previousFolders = getFolderMap(variables.workspaceId)
      return createOptimisticFolder(variables, tempId, previousFolders)
    },
    applyOptimisticUpdate: (tempId, item) => {
      queryClient.setQueryData<WorkflowFolder[]>(folderKeys.list(item.workspaceId), (old) => [
        ...(old ?? []),
        item,
      ])
    },
    replaceOptimisticEntry: (tempId, data) => {
      queryClient.setQueryData<WorkflowFolder[]>(folderKeys.list(data.workspaceId), (old) =>
        (old ?? []).map((folder) => (folder.id === tempId ? data : folder))
      )
    },
    rollback: (snapshot, variables) => {
      queryClient.setQueryData(folderKeys.list(variables.workspaceId), Object.values(snapshot))
    },
  })
}

export function useCreateFolder() {
  const queryClient = useQueryClient()

  const handlers = createFolderMutationHandlers<CreateFolderVariables>(
    queryClient,
    'CreateFolder',
    (variables, tempId, previousFolders) => {
      const currentWorkflows = Object.fromEntries(
        getWorkflows(variables.workspaceId).map((w) => [w.id, w])
      )

      return {
        id: tempId,
        name: variables.name,
        userId: '',
        workspaceId: variables.workspaceId,
        parentId: variables.parentId || null,
        color: variables.color || '#808080',
        isExpanded: false,
        locked: false,
        sortOrder:
          variables.sortOrder ??
          getTopInsertionSortOrder(
            currentWorkflows,
            previousFolders,
            variables.workspaceId,
            variables.parentId
          ),
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
      }
    },
    (variables) => variables.id ?? generateId()
  )

  return useMutation({
    mutationFn: async ({ workspaceId, sortOrder, ...payload }: CreateFolderVariables) => {
      const { folder } = await requestJson(createFolderContract, {
        body: { ...payload, workspaceId, sortOrder },
      })
      return mapFolder(folder)
    },
    ...handlers,
  })
}

export function useUpdateFolder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, id, updates }: UpdateFolderVariables) => {
      const { folder } = await requestJson(updateFolderContract, {
        params: { id },
        body: updates,
      })
      return mapFolder(folder)
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: folderKeys.list(variables.workspaceId) })
    },
  })
}

export function useDeleteFolderMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId: _workspaceId, id }: DeleteFolderVariables) => {
      return requestJson(deleteFolderContract, { params: { id } })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: folderKeys.lists() })
      return invalidateWorkflowLists(queryClient, variables.workspaceId, ['active', 'archived'])
    },
  })
}

interface RestoreFolderVariables {
  workspaceId: string
  folderId: string
}

export function useRestoreFolder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, folderId }: RestoreFolderVariables) => {
      return requestJson(restoreFolderContract, {
        params: { id: folderId },
        body: { workspaceId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: folderKeys.lists() })
      return invalidateWorkflowLists(queryClient, variables.workspaceId, ['active', 'archived'])
    },
  })
}

export function useDuplicateFolderMutation() {
  const queryClient = useQueryClient()

  const handlers = createFolderMutationHandlers<DuplicateFolderVariables>(
    queryClient,
    'DuplicateFolder',
    (variables, tempId, previousFolders) => {
      const currentWorkflows = Object.fromEntries(
        getWorkflows(variables.workspaceId).map((w) => [w.id, w])
      )

      const sourceFolder = previousFolders[variables.id]
      const targetParentId = variables.parentId ?? sourceFolder?.parentId ?? null
      return {
        id: tempId,
        name: variables.name,
        userId: sourceFolder?.userId || '',
        workspaceId: variables.workspaceId,
        parentId: targetParentId,
        color: variables.color || sourceFolder?.color || '#808080',
        isExpanded: false,
        locked: false,
        sortOrder: getTopInsertionSortOrder(
          currentWorkflows,
          previousFolders,
          variables.workspaceId,
          targetParentId
        ),
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
      }
    },
    (variables) => variables.newId ?? generateId()
  )

  return useMutation({
    mutationFn: async ({
      id,
      workspaceId,
      name,
      parentId,
      color,
      newId,
    }: DuplicateFolderVariables): Promise<WorkflowFolder> => {
      const { folder } = await requestJson(duplicateFolderContract, {
        params: { id },
        body: {
          workspaceId,
          name,
          parentId: parentId ?? null,
          color,
          newId,
        },
      })
      return mapFolder(folder)
    },
    ...handlers,
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: folderKeys.list(variables.workspaceId) })
      return invalidateWorkflowLists(queryClient, variables.workspaceId)
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
      await requestJson(reorderFoldersContract, { body: variables })
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: folderKeys.list(variables.workspaceId) })

      const snapshot = queryClient.getQueryData<WorkflowFolder[]>(
        folderKeys.list(variables.workspaceId)
      )

      const updatesById = new Map(variables.updates.map((update) => [update.id, update]))
      queryClient.setQueryData<WorkflowFolder[]>(folderKeys.list(variables.workspaceId), (old) => {
        if (!old?.length) return old
        return old.map((folder) => {
          const update = updatesById.get(folder.id)
          if (!update) return folder
          return {
            ...folder,
            sortOrder: update.sortOrder,
            parentId: update.parentId !== undefined ? update.parentId : folder.parentId,
          }
        })
      })

      return { snapshot }
    },
    onError: (_error, variables, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(folderKeys.list(variables.workspaceId), context.snapshot)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: folderKeys.list(variables.workspaceId) })
    },
  })
}
