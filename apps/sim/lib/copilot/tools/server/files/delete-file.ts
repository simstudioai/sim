import { createLogger } from '@sim/logger'
import { DeleteFile } from '@/lib/copilot/generated/tool-catalog-v1'
import { ensureWorkspaceAccess } from '@/lib/copilot/tools/handlers/access'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { isOutputsPath, isUploadsPath } from '@/lib/copilot/vfs/path-utils'
import {
  getWorkspaceFile,
  resolveWorkspaceFileReference,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { performDeleteWorkspaceFileItems } from '@/lib/workspace-files/orchestration'

const logger = createLogger('DeleteFileServerTool')

interface DeleteFileArgs {
  paths?: string[]
  path?: string
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
    const paths: string[] =
      params.paths ??
      (nested?.paths as string[] | undefined) ??
      [params.path || (nested?.path as string) || ''].filter(Boolean)
    const legacyFileIds: string[] =
      params.fileIds ??
      (nested?.fileIds as string[] | undefined) ??
      [params.fileId || (nested?.fileId as string) || ''].filter(Boolean)

    if (paths.length === 0 && legacyFileIds.length === 0) {
      return { success: false, message: 'paths is required' }
    }

    // Chat-scoped files are cleaned up with their chat, never by this tool —
    // reject with the policy (and never let 'outputs/x' resolve against a
    // workspace folder literally named "outputs" and delete THAT file).
    const chatScoped = paths.filter((p) => isOutputsPath(p) || isUploadsPath(p))
    if (chatScoped.length > 0) {
      return {
        success: false,
        message: `Chat-scoped uploads/ and outputs/ files cannot be deleted (${chatScoped.join(', ')}) — they are cleaned up with the chat. For a workspace file inside a folder literally named "outputs" or "uploads", use its files/… path.`,
      }
    }

    const deletable: { id: string; name: string }[] = []
    const failed: string[] = []

    for (const path of paths) {
      const existingFile = await resolveWorkspaceFileReference(workspaceId, path)
      if (!existingFile) {
        failed.push(path)
        continue
      }
      deletable.push({ id: existingFile.id, name: existingFile.name })
    }

    for (const fileId of legacyFileIds) {
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
