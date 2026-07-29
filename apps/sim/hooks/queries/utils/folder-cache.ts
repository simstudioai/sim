import type { FolderResourceType } from '@/lib/api/contracts/folders'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import type { WorkflowFolder } from '@/stores/folders/types'

const EMPTY_FOLDERS: WorkflowFolder[] = []

function getFolders(
  workspaceId: string,
  resourceType: FolderResourceType = 'workflow'
): WorkflowFolder[] {
  return (
    getQueryClient().getQueryData<WorkflowFolder[]>(
      folderKeys.list(workspaceId, 'active', resourceType)
    ) ?? EMPTY_FOLDERS
  )
}

export function getFolderMap(
  workspaceId: string,
  resourceType: FolderResourceType = 'workflow'
): Record<string, WorkflowFolder> {
  return Object.fromEntries(
    getFolders(workspaceId, resourceType).map((folder) => [folder.id, folder])
  )
}
