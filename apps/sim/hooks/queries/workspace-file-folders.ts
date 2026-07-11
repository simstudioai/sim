import { toast } from '@sim/emcn'
import { toError } from '@sim/utils/errors'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  bulkArchiveWorkspaceFileItemsContract,
  moveWorkspaceFileItemsContract,
} from '@/lib/api/contracts/workspace-file-folders'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

/**
 * Mixed-item (file + folder) mutations that address multiple ids at once.
 * Folder CRUD (create/rename/delete/restore) lives in `@/hooks/queries/folders`
 * (generic `resourceType: 'file'` hooks against `/api/folders/**`).
 */
function invalidateWorkspaceFileBrowsers(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string
) {
  queryClient.invalidateQueries({
    queryKey: folderKeys.workspaceResourceLists(workspaceId, 'file'),
  })
  queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.workspaceLists(workspaceId) })
  queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
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
