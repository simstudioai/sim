import { createLogger } from '@sim/logger'
import { DeleteFile } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  deleteWorkspaceFile,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('DeleteFileServerTool')

interface DeleteFileArgs {
  fileIds?: string[]
  fileId?: string
  args?: Record<string, unknown>
}

interface DeleteFileResult {
  success: boolean
  message: string
}

export const deleteFileServerTool: BaseServerTool<DeleteFileArgs, DeleteFileResult> = {
  name: DeleteFile.id,
  async execute(params: DeleteFileArgs, context?: ServerToolContext): Promise<DeleteFileResult> {
    if (!context?.userId) {
      throw new Error('Authentication required')
    }
    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }

    const nested = params.args
    const fileIds: string[] =
      params.fileIds ??
      (nested?.fileIds as string[] | undefined) ??
      [params.fileId || (nested?.fileId as string) || ''].filter(Boolean)

    if (fileIds.length === 0) return { success: false, message: 'fileIds is required' }

    const deleted: string[] = []
    const failed: string[] = []

    for (const fileId of fileIds) {
      const existingFile = await getWorkspaceFile(workspaceId, fileId)
      if (!existingFile) {
        failed.push(fileId)
        continue
      }

      assertServerToolNotAborted(context)
      await deleteWorkspaceFile(workspaceId, fileId)
      deleted.push(existingFile.name)

      logger.info('File deleted via delete_file', {
        fileId,
        name: existingFile.name,
        userId: context.userId,
      })
    }

    const parts: string[] = []
    if (deleted.length > 0) parts.push(`Deleted: ${deleted.join(', ')}`)
    if (failed.length > 0) parts.push(`Not found: ${failed.join(', ')}`)

    return {
      success: deleted.length > 0,
      message: parts.join('. '),
    }
  },
}
