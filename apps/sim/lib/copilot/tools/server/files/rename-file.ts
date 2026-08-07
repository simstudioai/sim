import { createLogger } from '@sim/logger'
import {
  createCopilotFilePrincipal,
  messageForCopilotFileError,
} from '@/lib/copilot/auth/file-delegation'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  getWorkspaceFile,
  resolveWorkspaceFileReference,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { renameWorkspaceFile } from '@/lib/workspace-files/application/rename-workspace-file'
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
    try {
      await renameWorkspaceFile.execute({
        principal: createCopilotFilePrincipal(context, workspaceId, fileId),
        input: { fileId, assertedWorkspaceId: workspaceId, name: newName },
      })
    } catch (error) {
      return { success: false, message: messageForCopilotFileError(error) }
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
