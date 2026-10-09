import { useMutation } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type PrepareUploadFoldersBody,
  prepareUploadFoldersContract,
} from '@/lib/api/contracts/workspace-file-folder-upload'

/** Folder preparation is not retried: a lost response may already have created the tree. */
export function usePrepareUploadFolders() {
  return useMutation({
    mutationFn: ({
      workspaceId,
      signal,
      ...body
    }: PrepareUploadFoldersBody & { workspaceId: string; signal?: AbortSignal }) =>
      requestJson(prepareUploadFoldersContract, { params: { id: workspaceId }, body, signal }),
    retry: false,
  })
}
