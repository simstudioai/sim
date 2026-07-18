import { createLogger } from '@sim/logger'
import { ensureWorkspaceAccess } from '@/lib/copilot/tools/handlers/access'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  getWorkspaceFile,
  resolveWorkspaceFileReference,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { performRenameWorkspaceFile } from '@/lib/workspace-files/orchestration'
import { validateFlatWorkspaceFileName } from './workspace-file'

const logger = createLogger('RenameFileServerTool')

interface RenameFileArgs {
  path?: string
  fileId?: string
  newName: string
  args?: Record<string, unknown>
}

interface RenameFileResult {
  success: boolean
  message: string
  data?: {
    id: string
    name: string
  }
}

/**
 * Removed from the mothership catalog in favor of mv; the executor stays
 * registered under its literal name so in-flight checkpoints paused on
 * rename_file still resume. Delete after the mv release soaks.
 */
export const renameFileServerTool: BaseServerTool<RenameFileArgs, RenameFileResult> = {
  name: 'rename_file',
  async execute(params: RenameFileArgs, context?: ServerToolContext): Promise<RenameFileResult> {
    if (!context?.userId) {
      throw new Error('Authentication required')
    }
    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }
    await ensureWorkspaceAccess(workspaceId, context.userId, 'write')

    const nested = params.args
    const path = params.path || (nested?.path as string) || ''
    const legacyFileId = params.fileId || (nested?.fileId as string) || ''
    const newName = params.newName || (nested?.newName as string) || ''

    const targetRef = path || legacyFileId
    if (!targetRef) return { success: false, message: 'path is required' }

    const nameError = validateFlatWorkspaceFileName(newName)
    if (nameError) return { success: false, message: nameError }

    const existingFile = path
      ? await resolveWorkspaceFileReference(workspaceId, path)
      : await getWorkspaceFile(workspaceId, legacyFileId)
    if (!existingFile) {
      return { success: false, message: `File not found: ${targetRef}` }
    }
    const fileId = existingFile.id

    assertServerToolNotAborted(context)
    const result = await performRenameWorkspaceFile({
      workspaceId,
      fileId,
      name: newName,
      userId: context.userId,
    })
    if (!result.success) {
      return { success: false, message: result.error || 'Failed to rename file' }
    }

    logger.info('File renamed via rename_file', {
      fileId,
      oldName: existingFile.name,
      newName,
      userId: context.userId,
    })

    return {
      success: true,
      message: `File renamed from "${existingFile.name}" to "${newName}"`,
      data: {
        id: fileId,
        name: newName,
      },
    }
  },
}
