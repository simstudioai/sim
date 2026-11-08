export type { FolderResourceType, ServedFolderResourceType } from '@/lib/api/contracts/folders'
export {
  useCreateFolder,
  useDeleteFolderMutation,
  useDuplicateFolderMutation,
  useFolderMap,
  useFolders,
  useReorderFolders,
  useRestoreFolder,
  useUpdateFolder,
} from '@/hooks/queries/folders'
export {
  useBulkArchiveWorkspaceFileItems,
  useCreateWorkspaceFileFolder,
  useExtractWorkspaceFile,
  useMoveWorkspaceFileItems,
  useRestoreWorkspaceFileFolder,
  useUpdateWorkspaceFileFolder,
  useWorkspaceFileFolders,
  type WorkspaceFileFolderApi,
} from '@/hooks/queries/workspace-file-folders'
export type { WorkflowFolder as ResourceFolder } from '@/stores/folders/types'
