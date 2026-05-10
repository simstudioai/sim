import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import type { WorkflowFolder } from '@/stores/folders/types'

const EMPTY_FOLDERS: WorkflowFolder[] = []

export function getFolders(workspaceId: string): WorkflowFolder[] {
  return (
    getQueryClient().getQueryData<WorkflowFolder[]>(folderKeys.list(workspaceId)) ?? EMPTY_FOLDERS
  )
}

export function getFolderMap(workspaceId: string): Record<string, WorkflowFolder> {
  return Object.fromEntries(getFolders(workspaceId).map((folder) => [folder.id, folder]))
}
