import { createLogger } from '@sim/logger'
import {
  executeCopilotFileUseCase,
  resolveCopilotWorkspaceFileReference,
} from '@/lib/copilot/application/execute-file-use-case'
import { messageForCopilotFileError } from '@/lib/copilot/auth/file-delegation'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileMetadata } from '@/lib/workspace-files/application/read-workspace-file-metadata'
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

    let existingFile
    try {
      existingFile = path
        ? await resolveCopilotWorkspaceFileReference(context, fileOperations.rename, {
            workspaceId,
            reference: path,
          })
        : (
            await executeCopilotFileUseCase(
              context,
              readWorkspaceFileMetadata,
              { fileId: legacyFileId, assertedWorkspaceId: workspaceId },
              { fileId: legacyFileId }
            )
          ).file
    } catch (error) {
      const classified = asOrchestrationError(error)
      if (classified?.code !== 'not_found') throw error
      return { success: false, message: `File not found: ${targetRef}` }
    }
    if (!existingFile) {
      return { success: false, message: `File not found: ${targetRef}` }
    }
    const fileId = existingFile.id

    assertServerToolNotAborted(context)
    try {
      await executeCopilotFileUseCase(
        context,
        renameWorkspaceFile,
        { fileId, assertedWorkspaceId: workspaceId, name: newName },
        { fileId }
      )
    } catch (error) {
      return { success: false, message: messageForCopilotFileError(error, 'Failed to rename file') }
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
