import { createLogger } from '@sim/logger'
import { RenameFile } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  getWorkspaceFile,
  renameWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { validateFlatWorkspaceFileName } from './workspace-file'

const logger = createLogger('RenameFileServerTool')

interface RenameFileArgs {
  fileId: string
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

export const renameFileServerTool: BaseServerTool<RenameFileArgs, RenameFileResult> = {
  name: RenameFile.id,
  async execute(params: RenameFileArgs, context?: ServerToolContext): Promise<RenameFileResult> {
    if (!context?.userId) {
      throw new Error('Authentication required')
    }
    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }

    const nested = params.args
    const fileId = params.fileId || (nested?.fileId as string) || ''
    const newName = params.newName || (nested?.newName as string) || ''

    if (!fileId) return { success: false, message: 'fileId is required' }

    const nameError = validateFlatWorkspaceFileName(newName)
    if (nameError) return { success: false, message: nameError }

    const existingFile = await getWorkspaceFile(workspaceId, fileId)
    if (!existingFile) {
      return { success: false, message: `File with ID "${fileId}" not found` }
    }

    assertServerToolNotAborted(context)
    await renameWorkspaceFile(workspaceId, fileId, newName)

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
