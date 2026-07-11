import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  createFolderContract,
  deleteFolderContract,
  duplicateFolderContract,
  type FolderApi,
  type FolderResourceType,
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
import type { Folder } from '@/stores/folders/types'

const logger = createLogger('FolderQueries')

export const FOLDER_LIST_STALE_TIME = 60 * 1000

/** Default resourceType so the pre-existing workflow-sidebar call sites need no changes. */
const DEFAULT_FOLDER_RESOURCE_TYPE: FolderResourceType = 'workflow'

/**
 * Maps a wire folder row to the client `Folder` shape (string dates →
 * `Date`). Exported so the server-side home prefetch produces the exact
 * cached value `useFolders` stores, keeping the hydrated entry in sync with
 * a client fetch.
 */
export function mapFolder(folder: FolderApi): Folder {
  return {
    id: folder.id,
    resourceType: folder.resourceType,
    name: folder.name,
    userId: folder.userId,
    workspaceId: folder.workspaceId,
    parentId: folder.parentId,
    locked: folder.locked,
    sortOrder: folder.sortOrder,
    createdAt: new Date(folder.createdAt),
    updatedAt: new Date(folder.updatedAt),
    deletedAt: folder.deletedAt ? new Date(folder.deletedAt) : null,
  }
}

async function fetchFolders(
  workspaceId: string,
  resourceType: FolderResourceType = DEFAULT_FOLDER_RESOURCE_TYPE,
  scope: FolderQueryScope = 'active',
  signal?: AbortSignal
): Promise<Folder[]> {
  const { folders } = await requestJson(listFoldersContract, {
    query: { workspaceId, resourceType, scope },
    signal,
  })
  return folders.map(mapFolder)
}

export function useFolders(
  workspaceId?: string,
  options?: { resourceType?: FolderResourceType; scope?: FolderQueryScope }
) {
  const resourceType = options?.resourceType ?? DEFAULT_FOLDER_RESOURCE_TYPE
  const scope = options?.scope ?? 'active'
  return useQuery({
    queryKey: folderKeys.list(workspaceId, resourceType, scope),
    queryFn: ({ signal }) => fetchFolders(workspaceId as string, resourceType, scope, signal),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    staleTime: FOLDER_LIST_STALE_TIME,
  })
}

const selectFolderMap = (folders: Folder[]): Record<string, Folder> =>
  Object.fromEntries(folders.map((folder) => [folder.id, folder]))

export function useFolderMap(workspaceId?: string, resourceType?: FolderResourceType) {
  const resolvedResourceType = resourceType ?? DEFAULT_FOLDER_RESOURCE_TYPE
  return useQuery({
    queryKey: folderKeys.list(workspaceId, resolvedResourceType),
    queryFn: ({ signal }) =>
      fetchFolders(workspaceId as string, resolvedResourceType, 'active', signal),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    staleTime: FOLDER_LIST_STALE_TIME,
    select: selectFolderMap,
  })
}

interface CreateFolderVariables {
  workspaceId: string
  resourceType?: FolderResourceType
  name: string
  parentId?: string
  sortOrder?: number
  id?: string
}

interface UpdateFolderVariables {
  workspaceId: string
  resourceType?: FolderResourceType
  id: string
  updates: Partial<Pick<Folder, 'name' | 'parentId' | 'sortOrder' | 'locked'>>
}

interface DeleteFolderVariables {
  workspaceId: string
  resourceType?: FolderResourceType
  id: string
}

interface DuplicateFolderVariables {
  workspaceId: string
  resourceType?: FolderResourceType
  id: string
  name: string
  parentId?: string | null
  newId?: string
}

/**
 * Creates optimistic mutation handlers for folder operations
 */
function createFolderMutationHandlers<
  TVariables extends { workspaceId: string; resourceType?: FolderResourceType },
>(
  queryClient: ReturnType<typeof useQueryClient>,
  name: string,
  createOptimisticFolder: (
    variables: TVariables,
    tempId: string,
    previousFolders: Record<string, Folder>
  ) => Folder,
  customGenerateTempId?: (variables: TVariables) => string
) {
  const queryKeyFor = (variables: Pick<TVariables, 'workspaceId' | 'resourceType'>) =>
    folderKeys.list(variables.workspaceId, variables.resourceType ?? DEFAULT_FOLDER_RESOURCE_TYPE)

  return createOptimisticMutationHandlers<Folder, TVariables, Folder>(queryClient, {
    name,
    getQueryKey: (variables) => queryKeyFor(variables),
    getSnapshot: (variables) => ({
      ...getFolderMap(
        variables.workspaceId,
        variables.resourceType ?? DEFAULT_FOLDER_RESOURCE_TYPE
      ),
    }),
    generateTempId: customGenerateTempId ?? (() => generateTempId('temp-folder')),
    createOptimisticItem: (variables, tempId) => {
      const previousFolders = getFolderMap(
        variables.workspaceId,
        variables.resourceType ?? DEFAULT_FOLDER_RESOURCE_TYPE
      )
      return createOptimisticFolder(variables, tempId, previousFolders)
    },
    applyOptimisticUpdate: (tempId, item) => {
      queryClient.setQueryData<Folder[]>(
        folderKeys.list(item.workspaceId, item.resourceType),
        (old) => [...(old ?? []), item]
      )
    },
    replaceOptimisticEntry: (tempId, data) => {
      queryClient.setQueryData<Folder[]>(
        folderKeys.list(data.workspaceId, data.resourceType),
        (old) => (old ?? []).map((folder) => (folder.id === tempId ? data : folder))
      )
    },
    rollback: (snapshot, variables) => {
      queryClient.setQueryData(queryKeyFor(variables), Object.values(snapshot))
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
        resourceType: variables.resourceType ?? DEFAULT_FOLDER_RESOURCE_TYPE,
        name: variables.name,
        userId: '',
        workspaceId: variables.workspaceId,
        parentId: variables.parentId || null,
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
      resourceType,
      sortOrder,
      ...payload
    }: CreateFolderVariables) => {
      const { folder } = await requestJson(createFolderContract, {
        body: {
          ...payload,
          workspaceId,
          resourceType: resourceType ?? DEFAULT_FOLDER_RESOURCE_TYPE,
          sortOrder,
        },
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
      queryClient.invalidateQueries({
        queryKey: folderKeys.list(
          variables.workspaceId,
          variables.resourceType ?? DEFAULT_FOLDER_RESOURCE_TYPE
        ),
      })
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
  resourceType?: FolderResourceType
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
        resourceType: variables.resourceType ?? DEFAULT_FOLDER_RESOURCE_TYPE,
        name: variables.name,
        userId: sourceFolder?.userId || '',
        workspaceId: variables.workspaceId,
        parentId: targetParentId,
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
    }: DuplicateFolderVariables): Promise<Folder> => {
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
      queryClient.invalidateQueries({
        queryKey: folderKeys.list(
          variables.workspaceId,
          variables.resourceType ?? DEFAULT_FOLDER_RESOURCE_TYPE
        ),
      })
      return invalidateWorkflowLists(queryClient, variables.workspaceId)
    },
  })
}

interface ReorderFoldersVariables {
  workspaceId: string
  resourceType?: FolderResourceType
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
      const { resourceType: _resourceType, ...body } = variables
      await requestJson(reorderFoldersContract, { body })
    },
    onMutate: async (variables) => {
      const queryKey = folderKeys.list(
        variables.workspaceId,
        variables.resourceType ?? DEFAULT_FOLDER_RESOURCE_TYPE
      )
      await queryClient.cancelQueries({ queryKey })

      const snapshot = queryClient.getQueryData<Folder[]>(queryKey)

      const updatesById = new Map(variables.updates.map((update) => [update.id, update]))
      queryClient.setQueryData<Folder[]>(queryKey, (old) => {
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

      return { snapshot, queryKey }
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(context.queryKey, context.snapshot)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: folderKeys.list(
          variables.workspaceId,
          variables.resourceType ?? DEFAULT_FOLDER_RESOURCE_TYPE
        ),
      })
    },
  })
}
