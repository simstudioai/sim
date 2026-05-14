import { toError } from '@sim/utils/errors'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import { requestJson } from '@/lib/api/client/request'
import {
  bulkArchiveWorkspaceFileItemsContract,
  createWorkspaceFileFolderContract,
  listWorkspaceFileFoldersContract,
  moveWorkspaceFileItemsContract,
  restoreWorkspaceFileFolderContract,
  updateWorkspaceFileFolderContract,
  type WorkspaceFileFolderApi,
} from '@/lib/api/contracts/workspace-file-folders'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

type WorkspaceFileFolderScope = 'active' | 'archived' | 'all'
export type { WorkspaceFileFolderApi }

export const workspaceFileFolderKeys = {
  all: ['workspaceFileFolders'] as const,
  lists: () => [...workspaceFileFolderKeys.all, 'list'] as const,
  workspaceLists: (workspaceId: string) =>
    [...workspaceFileFolderKeys.lists(), workspaceId] as const,
  list: (workspaceId: string, scope: WorkspaceFileFolderScope = 'active') =>
    [...workspaceFileFolderKeys.workspaceLists(workspaceId), scope] as const,
}

async function fetchWorkspaceFileFolders(
  workspaceId: string,
  scope: WorkspaceFileFolderScope,
  signal?: AbortSignal
): Promise<WorkspaceFileFolderApi[]> {
  const data = await requestJson(listWorkspaceFileFoldersContract, {
    params: { id: workspaceId },
    query: { scope },
    signal,
  })
  return data.folders
}

function invalidateWorkspaceFileBrowsers(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string
) {
  queryClient.invalidateQueries({ queryKey: workspaceFileFolderKeys.workspaceLists(workspaceId) })
  queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceLists(workspaceId) })
  queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
}

export function useWorkspaceFileFolders(
  workspaceId: string,
  scope: WorkspaceFileFolderScope = 'active'
) {
  return useQuery({
    queryKey: workspaceFileFolderKeys.list(workspaceId, scope),
    queryFn: ({ signal }) => fetchWorkspaceFileFolders(workspaceId, scope, signal),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useCreateWorkspaceFileFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: {
      workspaceId: string
      name: string
      parentId?: string | null
    }) => {
      const data = await requestJson(createWorkspaceFileFolderContract, {
        params: { id: variables.workspaceId },
        body: { name: variables.name, parentId: variables.parentId },
      })
      return data.folder
    },
    onSettled: (_data, _error, variables) => {
      invalidateWorkspaceFileBrowsers(queryClient, variables.workspaceId)
    },
  })
}

export function useUpdateWorkspaceFileFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: {
      workspaceId: string
      folderId: string
      updates: { name?: string; parentId?: string | null; sortOrder?: number }
    }) => {
      const data = await requestJson(updateWorkspaceFileFolderContract, {
        params: { id: variables.workspaceId, folderId: variables.folderId },
        body: variables.updates,
      })
      return data.folder
    },
    onMutate: async ({ workspaceId, folderId, updates }) => {
      await queryClient.cancelQueries({
        queryKey: workspaceFileFolderKeys.workspaceLists(workspaceId),
      })
      const previous = queryClient.getQueryData<WorkspaceFileFolderApi[]>(
        workspaceFileFolderKeys.list(workspaceId, 'active')
      )
      if (previous) {
        const target = previous.find((f) => f.id === folderId)
        const oldPath = target?.path
        const newPath =
          updates.name !== undefined && oldPath !== undefined
            ? [...oldPath.split('/').slice(0, -1), updates.name].filter(Boolean).join('/')
            : oldPath

        queryClient.setQueryData<WorkspaceFileFolderApi[]>(
          workspaceFileFolderKeys.list(workspaceId, 'active'),
          previous.map((f) => {
            if (f.id === folderId) {
              return { ...f, ...updates, ...(newPath !== undefined ? { path: newPath } : {}) }
            }
            // Recompute descendant paths so breadcrumbs stay correct during the optimistic window
            if (
              updates.name !== undefined &&
              oldPath !== undefined &&
              newPath !== undefined &&
              f.path?.startsWith(`${oldPath}/`)
            ) {
              return { ...f, path: `${newPath}${f.path.slice(oldPath.length)}` }
            }
            return f
          })
        )
      }
      return { previous }
    },
    onError: (err, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          workspaceFileFolderKeys.list(variables.workspaceId, 'active'),
          context.previous
        )
      }
      toast.error(toError(err).message)
    },
    onSettled: (_data, _error, variables) => {
      invalidateWorkspaceFileBrowsers(queryClient, variables.workspaceId)
    },
  })
}

export function useMoveWorkspaceFileItems() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: {
      workspaceId: string
      fileIds: string[]
      folderIds: string[]
      targetFolderId?: string | null
    }) => {
      return requestJson(moveWorkspaceFileItemsContract, {
        params: { id: variables.workspaceId },
        body: {
          fileIds: variables.fileIds,
          folderIds: variables.folderIds,
          targetFolderId: variables.targetFolderId,
        },
      })
    },
    onSuccess: (_data, variables) => {
      const total = variables.fileIds.length + variables.folderIds.length
      toast.success(
        `Moved ${total} item${total === 1 ? '' : 's'} ${variables.targetFolderId ? 'to folder' : 'to Files'}`
      )
    },
    onError: (error) => {
      toast.error(toError(error).message)
    },
    onSettled: (_data, _error, variables) => {
      invalidateWorkspaceFileBrowsers(queryClient, variables.workspaceId)
    },
  })
}

export function useBulkArchiveWorkspaceFileItems() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: {
      workspaceId: string
      fileIds: string[]
      folderIds: string[]
    }) => {
      return requestJson(bulkArchiveWorkspaceFileItemsContract, {
        params: { id: variables.workspaceId },
        body: { fileIds: variables.fileIds, folderIds: variables.folderIds },
      })
    },
    onSuccess: (_data, variables) => {
      const total = variables.fileIds.length + variables.folderIds.length
      toast.success(`Moved ${total} item${total === 1 ? '' : 's'} to trash`)
    },
    onError: (error) => {
      toast.error(toError(error).message)
    },
    onSettled: (_data, _error, variables) => {
      invalidateWorkspaceFileBrowsers(queryClient, variables.workspaceId)
    },
  })
}

export function useRestoreWorkspaceFileFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: { workspaceId: string; folderId: string }) =>
      requestJson(restoreWorkspaceFileFolderContract, {
        params: { id: variables.workspaceId, folderId: variables.folderId },
      }),
    onSuccess: () => {
      toast.success('Folder restored')
    },
    onError: (err) => {
      toast.error(toError(err).message)
    },
    onSettled: (_data, _error, variables) => {
      invalidateWorkspaceFileBrowsers(queryClient, variables.workspaceId)
    },
  })
}
