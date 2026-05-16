import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  CreateFileFolder,
  DeleteFileFolder,
  ListFileFolders,
  MoveFile,
  MoveFileFolder,
  RenameFileFolder,
} from '@/lib/copilot/generated/tool-catalog-v1'
import { ensureWorkspaceAccess } from '@/lib/copilot/tools/handlers/access'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  getWorkspaceFileFolder,
  listWorkspaceFileFolders,
  type WorkspaceFileFolderRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  performCreateWorkspaceFileFolder,
  performDeleteWorkspaceFileItems,
  performMoveWorkspaceFileItems,
  performUpdateWorkspaceFileFolder,
} from '@/lib/workspace-files/orchestration'

const logger = createLogger('FileFolderServerTools')

interface WorkspaceScopedArgs {
  workspaceId?: string
  args?: Record<string, unknown>
}

type ListFileFoldersArgs = WorkspaceScopedArgs

interface CreateFileFolderArgs extends WorkspaceScopedArgs {
  name?: string
  parentId?: string | null
}

interface RenameFileFolderArgs extends WorkspaceScopedArgs {
  folderId?: string
  name?: string
}

interface MoveFileFolderArgs extends WorkspaceScopedArgs {
  folderId?: string
  parentId?: string | null
}

interface DeleteFileFolderArgs extends WorkspaceScopedArgs {
  folderIds?: string[]
  folderId?: string
}

interface MoveFileArgs extends WorkspaceScopedArgs {
  fileIds?: string[]
  fileId?: string
  folderId?: string | null
}

interface FileFolderResult {
  success: boolean
  message: string
  data?: unknown
}

function nested(params: WorkspaceScopedArgs): Record<string, unknown> | undefined {
  return params.args && typeof params.args === 'object' ? params.args : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function stringArrayValue(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined
}

function nullableStringValue(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  return value.trim() ? value : null
}

async function resolveWorkspaceId(
  params: WorkspaceScopedArgs,
  context: ServerToolContext | undefined,
  permission: 'read' | 'write'
): Promise<string | FileFolderResult> {
  if (!context?.userId) {
    throw new Error('Authentication required')
  }

  const payload = nested(params)
  const workspaceId =
    stringValue(params.workspaceId) || stringValue(payload?.workspaceId) || context.workspaceId
  if (!workspaceId) {
    return { success: false, message: 'Workspace ID is required' }
  }

  await ensureWorkspaceAccess(workspaceId, context.userId, permission)
  return workspaceId
}

function folderLabel(folder: WorkspaceFileFolderRecord): string {
  return folder.path || folder.name
}

export const listFileFoldersServerTool: BaseServerTool<ListFileFoldersArgs, FileFolderResult> = {
  name: ListFileFolders.id,
  async execute(
    params: ListFileFoldersArgs,
    context?: ServerToolContext
  ): Promise<FileFolderResult> {
    try {
      const workspaceId = await resolveWorkspaceId(params, context, 'read')
      if (typeof workspaceId !== 'string') return workspaceId

      const folders = await listWorkspaceFileFolders(workspaceId)
      return {
        success: true,
        message:
          folders.length === 1 ? 'Found 1 file folder' : `Found ${folders.length} file folders`,
        data: { workspaceId, folders },
      }
    } catch (error) {
      return { success: false, message: toError(error).message }
    }
  },
}

export const createFileFolderServerTool: BaseServerTool<CreateFileFolderArgs, FileFolderResult> = {
  name: CreateFileFolder.id,
  async execute(
    params: CreateFileFolderArgs,
    context?: ServerToolContext
  ): Promise<FileFolderResult> {
    try {
      const workspaceId = await resolveWorkspaceId(params, context, 'write')
      if (typeof workspaceId !== 'string') return workspaceId
      if (!context?.userId) throw new Error('Authentication required')

      const payload = nested(params)
      const name = (stringValue(params.name) || stringValue(payload?.name) || '').trim()
      if (!name) return { success: false, message: 'name is required' }

      const parentId = nullableStringValue(params.parentId ?? payload?.parentId) ?? null

      assertServerToolNotAborted(context)
      const result = await performCreateWorkspaceFileFolder({
        workspaceId,
        userId: context.userId,
        name,
        parentId,
      })
      if (!result.success || !result.folder) {
        return { success: false, message: result.error || 'Failed to create file folder' }
      }
      const { folder } = result

      logger.info('File folder created via create_file_folder', {
        workspaceId,
        folderId: folder.id,
        parentId,
        userId: context.userId,
      })

      return {
        success: true,
        message: `Created file folder "${folderLabel(folder)}"`,
        data: { folder },
      }
    } catch (error) {
      return { success: false, message: toError(error).message }
    }
  },
}

export const renameFileFolderServerTool: BaseServerTool<RenameFileFolderArgs, FileFolderResult> = {
  name: RenameFileFolder.id,
  async execute(
    params: RenameFileFolderArgs,
    context?: ServerToolContext
  ): Promise<FileFolderResult> {
    try {
      const workspaceId = await resolveWorkspaceId(params, context, 'write')
      if (typeof workspaceId !== 'string') return workspaceId
      if (!context?.userId) throw new Error('Authentication required')

      const payload = nested(params)
      const folderId = stringValue(params.folderId) || stringValue(payload?.folderId) || ''
      const name = (stringValue(params.name) || stringValue(payload?.name) || '').trim()
      if (!folderId) return { success: false, message: 'folderId is required' }
      if (!name) return { success: false, message: 'name is required' }

      const existing = await getWorkspaceFileFolder(workspaceId, folderId)
      if (!existing) return { success: false, message: 'Folder not found' }

      assertServerToolNotAborted(context)
      const result = await performUpdateWorkspaceFileFolder({
        workspaceId,
        folderId,
        userId: context.userId,
        name,
      })
      if (!result.success || !result.folder) {
        return { success: false, message: result.error || 'Failed to rename file folder' }
      }
      const { folder } = result

      logger.info('File folder renamed via rename_file_folder', {
        workspaceId,
        folderId,
        oldName: existing.name,
        name,
        userId: context.userId,
      })

      return {
        success: true,
        message: `Renamed file folder "${folderLabel(existing)}" to "${folderLabel(folder)}"`,
        data: { folder },
      }
    } catch (error) {
      return { success: false, message: toError(error).message }
    }
  },
}

export const moveFileFolderServerTool: BaseServerTool<MoveFileFolderArgs, FileFolderResult> = {
  name: MoveFileFolder.id,
  async execute(
    params: MoveFileFolderArgs,
    context?: ServerToolContext
  ): Promise<FileFolderResult> {
    try {
      const workspaceId = await resolveWorkspaceId(params, context, 'write')
      if (typeof workspaceId !== 'string') return workspaceId
      if (!context?.userId) throw new Error('Authentication required')

      const payload = nested(params)
      const folderId = stringValue(params.folderId) || stringValue(payload?.folderId) || ''
      if (!folderId) return { success: false, message: 'folderId is required' }
      const parentId = nullableStringValue(params.parentId ?? payload?.parentId) ?? null

      assertServerToolNotAborted(context)
      const result = await performUpdateWorkspaceFileFolder({
        workspaceId,
        folderId,
        userId: context.userId,
        parentId,
      })
      if (!result.success || !result.folder) {
        return { success: false, message: result.error || 'Failed to move file folder' }
      }
      const { folder } = result

      logger.info('File folder moved via move_file_folder', {
        workspaceId,
        folderId,
        parentId,
        userId: context.userId,
      })

      return {
        success: true,
        message: parentId
          ? `Moved file folder "${folderLabel(folder)}"`
          : `Moved file folder "${folderLabel(folder)}" to root`,
        data: { folder },
      }
    } catch (error) {
      return { success: false, message: toError(error).message }
    }
  },
}

export const deleteFileFolderServerTool: BaseServerTool<DeleteFileFolderArgs, FileFolderResult> = {
  name: DeleteFileFolder.id,
  async execute(
    params: DeleteFileFolderArgs,
    context?: ServerToolContext
  ): Promise<FileFolderResult> {
    try {
      const workspaceId = await resolveWorkspaceId(params, context, 'write')
      if (typeof workspaceId !== 'string') return workspaceId
      if (!context?.userId) throw new Error('Authentication required')

      const payload = nested(params)
      const folderIds =
        params.folderIds ??
        stringArrayValue(payload?.folderIds) ??
        [stringValue(params.folderId) || stringValue(payload?.folderId) || ''].filter(Boolean)
      if (folderIds.length === 0) return { success: false, message: 'folderIds is required' }

      assertServerToolNotAborted(context)
      const result = await performDeleteWorkspaceFileItems({
        workspaceId,
        userId: context.userId,
        folderIds,
      })
      if (!result.success || !result.deletedItems) {
        return { success: false, message: result.error || 'Failed to delete file folders' }
      }

      logger.info('File folders deleted via delete_file_folder', {
        workspaceId,
        folderIds,
        folders: result.deletedItems.folders,
        files: result.deletedItems.files,
        userId: context.userId,
      })

      return {
        success: result.deletedItems.folders > 0 || result.deletedItems.files > 0,
        message: `Deleted ${result.deletedItems.folders} file folder${result.deletedItems.folders === 1 ? '' : 's'} and ${result.deletedItems.files} file${result.deletedItems.files === 1 ? '' : 's'}`,
        data: result.deletedItems,
      }
    } catch (error) {
      return { success: false, message: toError(error).message }
    }
  },
}

export const moveFileServerTool: BaseServerTool<MoveFileArgs, FileFolderResult> = {
  name: MoveFile.id,
  async execute(params: MoveFileArgs, context?: ServerToolContext): Promise<FileFolderResult> {
    try {
      const workspaceId = await resolveWorkspaceId(params, context, 'write')
      if (typeof workspaceId !== 'string') return workspaceId
      if (!context?.userId) throw new Error('Authentication required')

      const payload = nested(params)
      const fileIds =
        params.fileIds ??
        stringArrayValue(payload?.fileIds) ??
        [stringValue(params.fileId) || stringValue(payload?.fileId) || ''].filter(Boolean)
      if (fileIds.length === 0) return { success: false, message: 'fileIds is required' }

      const folderId = nullableStringValue(params.folderId ?? payload?.folderId) ?? null

      assertServerToolNotAborted(context)
      const result = await performMoveWorkspaceFileItems({
        workspaceId,
        userId: context.userId,
        fileIds,
        targetFolderId: folderId,
      })
      if (!result.success || !result.movedItems) {
        return { success: false, message: result.error || 'Failed to move files' }
      }

      logger.info('Files moved via move_file', {
        workspaceId,
        fileIds,
        folderId,
        movedFiles: result.movedItems.files,
        userId: context.userId,
      })

      return {
        success: result.movedItems.files > 0,
        message: folderId
          ? `Moved ${result.movedItems.files} file${result.movedItems.files === 1 ? '' : 's'}`
          : `Moved ${result.movedItems.files} file${result.movedItems.files === 1 ? '' : 's'} to root`,
        data: result.movedItems,
      }
    } catch (error) {
      return { success: false, message: toError(error).message }
    }
  },
}
