import type { SessionPrincipal } from '@sim/auth/principal'
import { captureServerEvent } from '@/lib/posthog/server'
import type {
  ArchiveWorkspaceFileItemsInput,
  ArchiveWorkspaceFileItemsResult,
} from '@/lib/workspace-files/application/archive-workspace-file-items'
import type { CreateWorkspaceFileResult } from '@/lib/workspace-files/application/create-workspace-file'
import type { DeleteWorkspaceFileResult } from '@/lib/workspace-files/application/delete-workspace-file'
import type { DownloadWorkspaceFileResult } from '@/lib/workspace-files/application/download-workspace-file'
import type {
  DownloadWorkspaceFileItemsInput,
  DownloadWorkspaceFileItemsResult,
} from '@/lib/workspace-files/application/download-workspace-file-items'
import type { MoveWorkspaceFileItemsInput } from '@/lib/workspace-files/application/move-workspace-file-items'
import type { RenameWorkspaceFileResult } from '@/lib/workspace-files/application/rename-workspace-file'
import type {
  CreateWorkspaceFileFolderInput,
  DeleteWorkspaceFileFolderInput,
  RestoreWorkspaceFileFolderInput,
  RestoreWorkspaceFileFolderResult,
  UpdateWorkspaceFileFolderInput,
} from '@/lib/workspace-files/application/workspace-file-folders'

interface InternalSuccessArgs<I = unknown, R = unknown> {
  principal: SessionPrincipal
  input: I
  result: R
}

export const internalFileAnalytics = {
  renamed({ principal, result }: InternalSuccessArgs<unknown, RenameWorkspaceFileResult>) {
    captureServerEvent(
      principal.userId,
      'file_renamed',
      { workspace_id: result.file.workspaceId },
      { groups: { workspace: result.file.workspaceId } }
    )
  },
  deleted({ principal, result }: InternalSuccessArgs<unknown, DeleteWorkspaceFileResult>) {
    captureServerEvent(
      principal.userId,
      'file_deleted',
      { workspace_id: result.workspaceId },
      { groups: { workspace: result.workspaceId } }
    )
  },
  downloaded({ principal, result }: InternalSuccessArgs<unknown, DownloadWorkspaceFileResult>) {
    captureServerEvent(
      principal.userId,
      'file_downloaded',
      { workspace_id: result.file.workspaceId, is_bulk: false, file_count: 1 },
      { groups: { workspace: result.file.workspaceId } }
    )
  },
  bulkDownloaded({
    principal,
    input,
    result,
  }: InternalSuccessArgs<DownloadWorkspaceFileItemsInput, DownloadWorkspaceFileItemsResult>) {
    captureServerEvent(
      principal.userId,
      'file_downloaded',
      {
        workspace_id: input.workspaceId,
        is_bulk: true,
        file_count: result.filesToZip.length,
      },
      { groups: { workspace: input.workspaceId } }
    )
  },
  uploaded({ principal, result }: InternalSuccessArgs<unknown, CreateWorkspaceFileResult>) {
    captureServerEvent(
      principal.userId,
      'file_uploaded',
      { workspace_id: result.file.workspaceId, file_type: result.file.type },
      { groups: { workspace: result.file.workspaceId } }
    )
  },
  bulkDeleted({
    principal,
    input,
  }: InternalSuccessArgs<ArchiveWorkspaceFileItemsInput, ArchiveWorkspaceFileItemsResult>) {
    captureServerEvent(
      principal.userId,
      'file_bulk_deleted',
      {
        workspace_id: input.workspaceId,
        file_count: input.fileIds?.length ?? 0,
        folder_count: input.folderIds?.length ?? 0,
      },
      { groups: { workspace: input.workspaceId } }
    )
  },
  /**
   * Reports the folder actually restored rather than the requested selector,
   * which is a path on surfaces that address folders by path and carries no id.
   */
  folderRestored({
    principal,
    input,
    result,
  }: InternalSuccessArgs<RestoreWorkspaceFileFolderInput, RestoreWorkspaceFileFolderResult>) {
    captureServerEvent(
      principal.userId,
      'folder_restored',
      { folder_id: result.folder.id, workspace_id: input.workspaceId },
      { groups: { workspace: input.workspaceId } }
    )
  },
  folderRenamed({ principal, input }: InternalSuccessArgs<UpdateWorkspaceFileFolderInput>) {
    captureServerEvent(
      principal.userId,
      'folder_renamed',
      { workspace_id: input.workspaceId },
      { groups: { workspace: input.workspaceId } }
    )
  },
  folderDeleted({ principal, input }: InternalSuccessArgs<DeleteWorkspaceFileFolderInput>) {
    captureServerEvent(
      principal.userId,
      'folder_deleted',
      { workspace_id: input.workspaceId },
      { groups: { workspace: input.workspaceId } }
    )
  },
  folderCreated({ principal, input }: InternalSuccessArgs<CreateWorkspaceFileFolderInput>) {
    captureServerEvent(
      principal.userId,
      'folder_created',
      { workspace_id: input.workspaceId },
      { groups: { workspace: input.workspaceId } }
    )
  },
  moved({ principal, input }: InternalSuccessArgs<MoveWorkspaceFileItemsInput>) {
    if (input.fileIds && input.fileIds.length > 0) {
      captureServerEvent(
        principal.userId,
        'file_moved',
        {
          workspace_id: input.workspaceId,
          file_count: input.fileIds.length,
          folder_count: input.folderIds?.length ?? 0,
        },
        { groups: { workspace: input.workspaceId } }
      )
    }
    if (input.folderIds && input.folderIds.length > 0) {
      captureServerEvent(
        principal.userId,
        'folder_moved',
        {
          workspace_id: input.workspaceId,
          file_count: input.fileIds?.length ?? 0,
          folder_count: input.folderIds.length,
        },
        { groups: { workspace: input.workspaceId } }
      )
    }
  },
} as const
