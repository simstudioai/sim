import { createLogger } from '@sim/logger'
import { appendCopilotLogContext } from '@/lib/copilot/logging'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import type { WorkspaceFileArgs, WorkspaceFileResult } from '@/lib/copilot/tools/shared/schemas'
import { generatePptxFromCode } from '@/lib/execution/pptx-vm'
import {
  deleteWorkspaceFile,
  downloadWorkspaceFile as downloadWsFile,
  getWorkspaceFile,
  renameWorkspaceFile,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('WorkspaceFileServerTool')

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const PPTX_SOURCE_MIME = 'text/x-pptxgenjs'

const EXT_TO_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.pptx': PPTX_MIME,
}

function inferContentType(fileName: string, explicitType?: string): string {
  if (explicitType) return explicitType
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  return EXT_TO_MIME[ext] || 'text/plain'
}

function validateFlatWorkspaceFileName(fileName: string): string | null {
  const trimmed = fileName.trim()
  if (!trimmed) return 'File name cannot be empty'
  if (trimmed.includes('/')) {
    return 'Workspace files use a flat namespace. Use a plain file name like "report.csv", not a path like "files/reports/report.csv".'
  }
  return null
}

export const workspaceFileServerTool: BaseServerTool<WorkspaceFileArgs, WorkspaceFileResult> = {
  name: 'workspace_file',
  async execute(
    params: WorkspaceFileArgs,
    context?: ServerToolContext
  ): Promise<WorkspaceFileResult> {
    const withMessageId = (message: string) =>
      appendCopilotLogContext(message, { messageId: context?.messageId })

    if (!context?.userId) {
      logger.error(withMessageId('Unauthorized attempt to access workspace files'))
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
          const fileNameValidationError = validateFlatWorkspaceFileName(fileName)
          if (fileNameValidationError) {
            return { success: false, message: fileNameValidationError }
          }

          const isPptx = fileName.toLowerCase().endsWith('.pptx')
          let contentType: string

          if (isPptx) {
            // Validate the code compiles before storing
            try {
              await generatePptxFromCode(content, workspaceId)
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              logger.error(withMessageId('PPTX code validation failed'), { error: msg, fileName })
              return {
                success: false,
                message: `PPTX generation failed: ${msg}. Fix the pptxgenjs code and retry.`,
              }
            }
            contentType = PPTX_SOURCE_MIME
          } else {
            contentType = inferContentType(fileName, explicitType)
          }

          const fileBuffer = Buffer.from(content, 'utf-8')

          assertServerToolNotAborted(context)
          const result = await uploadWorkspaceFile(
            workspaceId,
            context.userId,
            fileBuffer,
            fileName,
            contentType
          )

          logger.info(withMessageId('Workspace file written via copilot'), {
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

          const isPptxUpdate = fileRecord.name?.toLowerCase().endsWith('.pptx')
          if (isPptxUpdate) {
            try {
              await generatePptxFromCode(content, workspaceId)
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              return {
                success: false,
                message: `PPTX generation failed: ${msg}. Fix the pptxgenjs code and retry.`,
              }
            }
          }

          const fileBuffer = Buffer.from(content, 'utf-8')

          assertServerToolNotAborted(context)
          await updateWorkspaceFileContent(
            workspaceId,
            fileId,
            context.userId,
            fileBuffer,
            isPptxUpdate ? PPTX_SOURCE_MIME : undefined
          )

          logger.info(withMessageId('Workspace file updated via copilot'), {
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
          const fileNameValidationError = validateFlatWorkspaceFileName(newName)
          if (fileNameValidationError) {
            return { success: false, message: fileNameValidationError }
          }

          const fileRecord = await getWorkspaceFile(workspaceId, fileId)
          if (!fileRecord) {
            return { success: false, message: `File with ID "${fileId}" not found` }
          }

          const oldName = fileRecord.name
          assertServerToolNotAborted(context)
          await renameWorkspaceFile(workspaceId, fileId, newName)

          logger.info(withMessageId('Workspace file renamed via copilot'), {
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

          assertServerToolNotAborted(context)
          await deleteWorkspaceFile(workspaceId, fileId)

          logger.info(withMessageId('Workspace file deleted via copilot'), {
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

        case 'patch': {
          const fileId = (args as Record<string, unknown>).fileId as string | undefined
          const edits = (args as Record<string, unknown>).edits as
            | { search: string; replace: string }[]
            | undefined

          if (!fileId) {
            return { success: false, message: 'fileId is required for patch operation' }
          }
          if (!edits || !Array.isArray(edits) || edits.length === 0) {
            return { success: false, message: 'edits array is required for patch operation' }
          }

          const fileRecord = await getWorkspaceFile(workspaceId, fileId)
          if (!fileRecord) {
            return { success: false, message: `File with ID "${fileId}" not found` }
          }

          const currentBuffer = await downloadWsFile(fileRecord)
          let content = currentBuffer.toString('utf-8')

          for (const edit of edits) {
            const firstIdx = content.indexOf(edit.search)
            if (firstIdx === -1) {
              return {
                success: false,
                message: `Patch failed: search string not found in file "${fileRecord.name}". Search: "${edit.search.slice(0, 100)}${edit.search.length > 100 ? '...' : ''}"`,
              }
            }
            if (content.indexOf(edit.search, firstIdx + 1) !== -1) {
              return {
                success: false,
                message: `Patch failed: search string is ambiguous — found at multiple locations in "${fileRecord.name}". Use a longer, unique search string.`,
              }
            }
            content =
              content.slice(0, firstIdx) +
              edit.replace +
              content.slice(firstIdx + edit.search.length)
          }

          const isPptxPatch = fileRecord.name?.toLowerCase().endsWith('.pptx')
          if (isPptxPatch) {
            try {
              await generatePptxFromCode(content, workspaceId)
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              return {
                success: false,
                message: `Patched PPTX code failed to compile: ${msg}. Fix the edits and retry.`,
              }
            }
          }

          const patchedBuffer = Buffer.from(content, 'utf-8')
          assertServerToolNotAborted(context)
          await updateWorkspaceFileContent(
            workspaceId,
            fileId,
            context.userId,
            patchedBuffer,
            isPptxPatch ? PPTX_SOURCE_MIME : undefined
          )

          logger.info(withMessageId('Workspace file patched via copilot'), {
            fileId,
            name: fileRecord.name,
            editCount: edits.length,
            userId: context.userId,
          })

          return {
            success: true,
            message: `File "${fileRecord.name}" patched successfully (${edits.length} edit${edits.length > 1 ? 's' : ''} applied)`,
            data: {
              id: fileId,
              name: fileRecord.name,
              size: patchedBuffer.length,
            },
          }
        }

        default:
          return {
            success: false,
            message: `Unknown operation: ${operation}. Supported: write, update, patch, rename, delete.`,
          }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      logger.error(withMessageId('Error in workspace_file tool'), {
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
