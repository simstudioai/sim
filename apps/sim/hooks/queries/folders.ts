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
  type ServedFolderResourceType,
  updateFolderContract,
} from '@/lib/api/contracts'
import { knowledgeKeys } from '@/hooks/queries/kb/knowledge'
import { getFolderMap } from '@/hooks/queries/utils/folder-cache'
import { type FolderQueryScope, folderKeys } from '@/hooks/queries/utils/folder-keys'
import { invalidateWorkflowLists } from '@/hooks/queries/utils/invalidate-workflow-lists'
import {
  createOptimisticMutationHandlers,
  generateTempId,
} from '@/hooks/queries/utils/optimistic-mutation'
import { tableKeys } from '@/hooks/queries/utils/table-keys'
import { getTopInsertionSortOrder } from '@/hooks/queries/utils/top-insertion-sort-order'
import { getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import type { WorkflowFolder } from '@/stores/folders/types'

const logger = createLogger('FolderQueries')

export const FOLDER_LIST_STALE_TIME = 60 * 1000

/**
 * Maps a wire folder row to the client `WorkflowFolder` shape (string dates →
 * `Date`). Exported so the server-side home prefetch produces
 * the exact cached value `useFolders` stores, keeping the hydrated entry in
 * sync with a client fetch.
 */
export function mapFolder(folder: FolderApi): WorkflowFolder {
  return {
    id: folder.id,
    name: folder.name,
    userId: folder.userId,
    workspaceId: folder.workspaceId,
    parentId: folder.parentId,
    resourceType: folder.resourceType,
    locked: folder.locked,
    sortOrder: folder.sortOrder,
    createdAt: new Date(folder.createdAt),
    updatedAt: new Date(folder.updatedAt),
    deletedAt: folder.deletedAt ? new Date(folder.deletedAt) : null,
  }
}

async function fetchFolders(
  workspaceId: string,
  scope: FolderQueryScope = 'active',
  resourceType: ServedFolderResourceType = 'workflow',
  signal?: AbortSignal
): Promise<WorkflowFolder[]> {
  const { folders } = await requestJson(listFoldersContract, {
    query: { workspaceId, scope, resourceType },
    signal,
  })
  return folders.map(mapFolder)
}

export function useFolders(
  workspaceId?: string,
  options?: {
    scope?: FolderQueryScope
    enabled?: boolean
    resourceType?: ServedFolderResourceType
  }
) {
  const scope = options?.scope ?? 'active'
  const resourceType = options?.resourceType ?? 'workflow'
  return useQuery({
    queryKey: folderKeys.list(workspaceId, scope, resourceType),
    queryFn: ({ signal }) => fetchFolders(workspaceId as string, scope, resourceType, signal),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    placeholderData: keepPreviousData,
    staleTime: FOLDER_LIST_STALE_TIME,
  })
}

const selectFolderMap = (folders: WorkflowFolder[]): Record<string, WorkflowFolder> =>
  Object.fromEntries(folders.map((folder) => [folder.id, folder]))

export function useFolderMap(
  workspaceId?: string,
  resourceType: ServedFolderResourceType = 'workflow'
) {
  return useQuery({
    queryKey: folderKeys.list(workspaceId, 'active', resourceType),
    queryFn: ({ signal }) => fetchFolders(workspaceId as string, 'active', resourceType, signal),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    staleTime: FOLDER_LIST_STALE_TIME,
    select: selectFolderMap,
  })
}

interface CreateFolderVariables {
  workspaceId: string
  resourceType?: ServedFolderResourceType
  name: string
  parentId?: string
  sortOrder?: number
  id?: string
}

interface UpdateFolderVariables {
  workspaceId: string
  resourceType?: ServedFolderResourceType
  id: string
  updates: Partial<Pick<WorkflowFolder, 'name' | 'parentId' | 'sortOrder' | 'locked'>>
}

interface DeleteFolderVariables {
  workspaceId: string
  resourceType?: ServedFolderResourceType
  id: string
}

interface DuplicateFolderVariables {
  workspaceId: string
  id: string
  name: string
  parentId?: string | null
  newId?: string
}

/**
 * Refreshes the lists that a folder delete/restore cascade rewrote.
 *
 * The cascade archives or restores the resources inside the folder subtree, so
 * the folder tree alone going stale is not enough — the resource list that
 * renders those rows has to refetch too. Each resource type owns a different
 * cache, hence the switch; a type with no list surface yet is a no-op.
 */
function invalidateCascadedResourceLists(
  queryClient: ReturnType<typeof useQueryClient>,
  resourceType: ServedFolderResourceType,
  workspaceId: string
): Promise<void> | void {
  switch (resourceType) {
    case 'workflow':
      return invalidateWorkflowLists(queryClient, workspaceId, ['active', 'archived'])
    case 'table':
      return queryClient.invalidateQueries({ queryKey: tableKeys.lists() })
    case 'knowledge_base':
      return queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists() })
    /**
     * `file` has no case: the Files page reads and writes its folders through
     * `/api/workspaces/[id]/files/folders/**`, which owns its own invalidation, so a
     * cascade never reaches this hook for that tree.
     */
    default:
      return
  }
}

/**
 * Creates optimistic mutation handlers for folder operations
 */
function createFolderMutationHandlers<
  TVariables extends { workspaceId: string; resourceType?: ServedFolderResourceType },
>(
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
    getQueryKey: (variables) =>
      folderKeys.list(variables.workspaceId, 'active', variables.resourceType ?? 'workflow'),
    getSnapshot: (variables) => ({
      ...getFolderMap(variables.workspaceId, variables.resourceType ?? 'workflow'),
    }),
    generateTempId: customGenerateTempId ?? (() => generateTempId('temp-folder')),
    createOptimisticItem: (variables, tempId) => {
      const previousFolders = getFolderMap(
        variables.workspaceId,
        variables.resourceType ?? 'workflow'
      )
      return createOptimisticFolder(variables, tempId, previousFolders)
    },
    applyOptimisticUpdate: (tempId, item) => {
      queryClient.setQueryData<WorkflowFolder[]>(
        folderKeys.list(item.workspaceId, 'active', item.resourceType),
        (old) => [...(old ?? []), item]
      )
    },
    replaceOptimisticEntry: (tempId, data) => {
      queryClient.setQueryData<WorkflowFolder[]>(
        folderKeys.list(data.workspaceId, 'active', data.resourceType),
        (old) => (old ?? []).map((folder) => (folder.id === tempId ? data : folder))
      )
    },
    rollback: (snapshot, variables) => {
      queryClient.setQueryData(
        folderKeys.list(variables.workspaceId, 'active', variables.resourceType ?? 'workflow'),
        Object.values(snapshot)
      )
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
        resourceType: variables.resourceType ?? 'workflow',
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
        deletedAt: null,
      }
    },
    (variables) => variables.id ?? generateId()
  )

  return useMutation({
    mutationFn: async ({
      workspaceId,
      sortOrder,
      resourceType = 'workflow',
      ...payload
    }: CreateFolderVariables) => {
      const { folder } = await requestJson(createFolderContract, {
        body: { ...payload, workspaceId, sortOrder, resourceType },
      })
      return mapFolder(folder)
    },
    ...handlers,
  })
}

export function useUpdateFolder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId: _workspaceId,
      resourceType = 'workflow',
      id,
      updates,
    }: UpdateFolderVariables) => {
      const { folder } = await requestJson(updateFolderContract, {
        params: { id },
        query: { resourceType },
        body: updates,
      })
      return mapFolder(folder)
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: folderKeys.resource(variables.resourceType ?? 'workflow'),
      })
    },
  })
}

export function useDeleteFolderMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId: _workspaceId,
      resourceType = 'workflow',
      id,
    }: DeleteFolderVariables) => {
      return requestJson(deleteFolderContract, { params: { id }, query: { resourceType } })
    },
    onSettled: (_data, _error, variables) => {
      const resourceType = variables.resourceType ?? 'workflow'
      queryClient.invalidateQueries({ queryKey: folderKeys.resource(resourceType) })
      return invalidateCascadedResourceLists(queryClient, resourceType, variables.workspaceId)
    },
  })
}

interface RestoreFolderVariables {
  workspaceId: string
  resourceType?: ServedFolderResourceType
  folderId: string
}

export function useRestoreFolder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      resourceType = 'workflow',
      folderId,
    }: RestoreFolderVariables) => {
      return requestJson(restoreFolderContract, {
        params: { id: folderId },
        body: { workspaceId, resourceType },
      })
    },
    onSettled: (_data, _error, variables) => {
      const resourceType = variables.resourceType ?? 'workflow'
      queryClient.invalidateQueries({ queryKey: folderKeys.resource(resourceType) })
      return invalidateCascadedResourceLists(queryClient, resourceType, variables.workspaceId)
    },
  })
}

/**
 * Workflow-only by design, unlike the other folder mutations in this file: duplication copies
 * the workflows inside the folder, and `POST /api/folders/[id]/duplicate` has no equivalent
 * for knowledge bases or tables. The `resourceType: 'workflow'` below is that constraint, not
 * an oversight — generalizing it would optimistically insert a folder the route then refuses.
 */
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
        resourceType: 'workflow' as const,
        locked: false,
        sortOrder: getTopInsertionSortOrder(
          currentWorkflows,
          previousFolders,
          variables.workspaceId,
          targetParentId
        ),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
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
      newId,
    }: DuplicateFolderVariables): Promise<WorkflowFolder> => {
      const { folder } = await requestJson(duplicateFolderContract, {
        params: { id },
        body: {
          workspaceId,
          name,
          parentId: parentId ?? null,
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
  resourceType?: ServedFolderResourceType
  updates: Array<{
    id: string
    sortOrder: number
    parentId?: string | null
  }>
}

export function useReorderFolders() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      resourceType = 'workflow',
      ...variables
    }: ReorderFoldersVariables): Promise<void> => {
      await requestJson(reorderFoldersContract, { body: { ...variables, resourceType } })
    },
    onMutate: async (variables) => {
      const listKey = folderKeys.list(
        variables.workspaceId,
        'active',
        variables.resourceType ?? 'workflow'
      )
      await queryClient.cancelQueries({ queryKey: listKey })

      const snapshot = queryClient.getQueryData<WorkflowFolder[]>(listKey)

      const updatesById = new Map(variables.updates.map((update) => [update.id, update]))
      queryClient.setQueryData<WorkflowFolder[]>(listKey, (old) => {
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
        queryClient.setQueryData(
          folderKeys.list(variables.workspaceId, 'active', variables.resourceType ?? 'workflow'),
          context.snapshot
        )
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: folderKeys.list(
          variables.workspaceId,
          'active',
          variables.resourceType ?? 'workflow'
        ),
      })
    },
  })
}
