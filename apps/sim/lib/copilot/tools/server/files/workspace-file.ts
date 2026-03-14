import { createLogger } from '@sim/logger'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import type { WorkspaceFileArgs, WorkspaceFileResult } from '@/lib/copilot/tools/shared/schemas'
import {
  deleteWorkspaceFile,
  getWorkspaceFile,
  renameWorkspaceFile,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('WorkspaceFileServerTool')

const EXT_TO_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.json': 'application/json',
  '.csv': 'text/csv',
}

function inferContentType(fileName: string, explicitType?: string): string {
  if (explicitType) return explicitType
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  return EXT_TO_MIME[ext] || 'text/plain'
}

export const workspaceFileServerTool: BaseServerTool<WorkspaceFileArgs, WorkspaceFileResult> = {
  name: 'workspace_file',
  async execute(
    params: WorkspaceFileArgs,
    context?: ServerToolContext
  ): Promise<WorkspaceFileResult> {
    if (!context?.userId) {
      logger.error('Unauthorized attempt to access workspace files')
      throw new Error('Authentication required')
    }

    const { operation, args = {} } = params
    const workspaceId =
      context.workspaceId || ((args as Record<string, unknown>).workspaceId as string | undefined)

    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }

    try {
      switch (operation) {
        case 'write': {
          const fileName = (args as Record<string, unknown>).fileName as string | undefined
          const content = (args as Record<string, unknown>).content as string | undefined
          const explicitType = (args as Record<string, unknown>).contentType as string | undefined

          if (!fileName) {
            return { success: false, message: 'fileName is required for write operation' }
          }
          if (content === undefined || content === null) {
            return { success: false, message: 'content is required for write operation' }
          }

          const contentType = inferContentType(fileName, explicitType)
          const fileBuffer = Buffer.from(content, 'utf-8')
          const result = await uploadWorkspaceFile(
            workspaceId,
            context.userId,
            fileBuffer,
            fileName,
            contentType
          )

          logger.info('Workspace file written via copilot', {
            fileId: result.id,
            name: fileName,
            size: fileBuffer.length,
            contentType,
            userId: context.userId,
          })

          return {
            success: true,
            message: `File "${fileName}" created successfully (${fileBuffer.length} bytes)`,
            data: {
              id: result.id,
              name: result.name,
              contentType,
              size: fileBuffer.length,
              downloadUrl: result.url,
            },
          }
        }

        case 'update': {
          const fileId = (args as Record<string, unknown>).fileId as string | undefined
          const content = (args as Record<string, unknown>).content as string | undefined

          if (!fileId) {
            return { success: false, message: 'fileId is required for update operation' }
          }
          if (content === undefined || content === null) {
            return { success: false, message: 'content is required for update operation' }
          }

          const fileRecord = await getWorkspaceFile(workspaceId, fileId)
          if (!fileRecord) {
            return { success: false, message: `File with ID "${fileId}" not found` }
          }

          const fileBuffer = Buffer.from(content, 'utf-8')
          await updateWorkspaceFileContent(workspaceId, fileId, context.userId, fileBuffer)

          logger.info('Workspace file updated via copilot', {
            fileId,
            name: fileRecord.name,
            size: fileBuffer.length,
            userId: context.userId,
          })

          return {
            success: true,
            message: `File "${fileRecord.name}" updated successfully (${fileBuffer.length} bytes)`,
            data: {
              id: fileId,
              name: fileRecord.name,
              size: fileBuffer.length,
            },
          }
        }

        case 'rename': {
          const fileId = (args as Record<string, unknown>).fileId as string | undefined
          const newName = (args as Record<string, unknown>).newName as string | undefined

          if (!fileId) {
            return { success: false, message: 'fileId is required for rename operation' }
          }
          if (!newName) {
            return { success: false, message: 'newName is required for rename operation' }
          }

          const fileRecord = await getWorkspaceFile(workspaceId, fileId)
          if (!fileRecord) {
            return { success: false, message: `File with ID "${fileId}" not found` }
          }

          const oldName = fileRecord.name
          await renameWorkspaceFile(workspaceId, fileId, newName)

          logger.info('Workspace file renamed via copilot', {
            fileId,
            oldName,
            newName,
            userId: context.userId,
          })

          return {
            success: true,
            message: `File renamed from "${oldName}" to "${newName}"`,
            data: { id: fileId, name: newName },
          }
        }

        case 'delete': {
          const fileId = (args as Record<string, unknown>).fileId as string | undefined
          if (!fileId) {
            return { success: false, message: 'fileId is required for delete operation' }
          }

          const fileRecord = await getWorkspaceFile(workspaceId, fileId)
          if (!fileRecord) {
            return { success: false, message: `File with ID "${fileId}" not found` }
          }

          await deleteWorkspaceFile(workspaceId, fileId)

          logger.info('Workspace file deleted via copilot', {
            fileId,
            name: fileRecord.name,
            userId: context.userId,
          })

          return {
            success: true,
            message: `File "${fileRecord.name}" deleted successfully`,
            data: { id: fileId, name: fileRecord.name },
          }
        }

        default:
          return {
            success: false,
            message: `Unknown operation: ${operation}. Supported: write, update, rename, delete. Use the filesystem to list/read files.`,
          }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      logger.error('Error in workspace_file tool', {
        operation,
        error: errorMessage,
        userId: context.userId,
      })

      return {
        success: false,
        message: `Failed to ${operation} file: ${errorMessage}`,
      }
    }
  },
}
