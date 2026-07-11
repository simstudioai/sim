import type { FolderResourceType } from '@/lib/api/contracts/folders'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import type { Folder } from '@/stores/folders/types'

const EMPTY_FOLDERS: Folder[] = []

export function getFolders(
  workspaceId: string,
  resourceType: FolderResourceType = 'workflow'
): Folder[] {
  return (
    getQueryClient().getQueryData<Folder[]>(folderKeys.list(workspaceId, resourceType)) ??
    EMPTY_FOLDERS
  )
}

export function getFolderMap(
  workspaceId: string,
  resourceType: FolderResourceType = 'workflow'
): Record<string, Folder> {
  return Object.fromEntries(
    getFolders(workspaceId, resourceType).map((folder) => [folder.id, folder])
  )
}
