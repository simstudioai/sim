import { createLogger } from '@sim/logger'
import { DeleteFile } from '@/lib/copilot/generated/tool-catalog-v1'
import { ensureWorkspaceAccess } from '@/lib/copilot/tools/handlers/access'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { performDeleteWorkspaceFileItems } from '@/lib/workspace-files/orchestration'

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
    await ensureWorkspaceAccess(workspaceId, context.userId, 'write')

    const nested = params.args
    const fileIds: string[] =
      params.fileIds ??
      (nested?.fileIds as string[] | undefined) ??
      [params.fileId || (nested?.fileId as string) || ''].filter(Boolean)

    if (fileIds.length === 0) return { success: false, message: 'fileIds is required' }

    const deletable: { id: string; name: string }[] = []
    const failed: string[] = []

    for (const fileId of fileIds) {
      const existingFile = await getWorkspaceFile(workspaceId, fileId)
      if (!existingFile) {
        failed.push(fileId)
        continue
      }
      deletable.push({ id: fileId, name: existingFile.name })
    }

    if (deletable.length > 0) {
      assertServerToolNotAborted(context)
      const result = await performDeleteWorkspaceFileItems({
        workspaceId,
        userId: context.userId,
        fileIds: deletable.map((file) => file.id),
      })
      if (!result.success) {
        return { success: false, message: result.error || 'Failed to delete files' }
      }
    }

    for (const file of deletable) {
      logger.info('File deleted via delete_file', {
        fileId: file.id,
        name: file.name,
        userId: context.userId,
      })
    }

    const parts: string[] = []
    if (deletable.length > 0)
      parts.push(`Deleted: ${deletable.map((file) => file.name).join(', ')}`)
    if (failed.length > 0) parts.push(`Not found: ${failed.join(', ')}`)

    return {
      success: deletable.length > 0,
      message: parts.join('. '),
    }
  },
}
