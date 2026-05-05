import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { WorkspaceFile } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { runSandboxTask } from '@/lib/execution/sandbox/run-task'
import {
  deleteWorkspaceFile,
  fetchWorkspaceFileBuffer as downloadWsFile,
  getWorkspaceFile,
  getWorkspaceFileByName,
  renameWorkspaceFile,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import type { SandboxTaskId } from '@/sandbox-tasks/registry'
import { storeFileIntent } from './file-intent-store'

const logger = createLogger('WorkspaceFileServerTool')

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PDF_MIME = 'application/pdf'
const PPTX_SOURCE_MIME = 'text/x-pptxgenjs'
const DOCX_SOURCE_MIME = 'text/x-docxjs'
const PDF_SOURCE_MIME = 'text/x-pdflibjs'

type WorkspaceFileOperation = 'create' | 'append' | 'update' | 'delete' | 'rename' | 'patch'

type WorkspaceFileTarget =
  | {
      kind: 'new_file'
      fileName: string
      fileId?: string
    }
  | {
      kind: 'file_id'
      fileId: string
      fileName?: string
    }

type WorkspaceFileEdit =
  | {
      strategy: 'search_replace'
      search: string
      replace: string
      replaceAll?: boolean
    }
  | {
      strategy: 'anchored'
      mode: 'replace_between' | 'insert_after' | 'delete_between'
      occurrence?: number
      before_anchor?: string
      after_anchor?: string
      start_anchor?: string
      end_anchor?: string
      anchor?: string
      content?: string
    }

type WorkspaceFileArgs = {
  operation: WorkspaceFileOperation
  target?: WorkspaceFileTarget
  title?: string
  content?: string
  contentType?: string
  newName?: string
  edit?: WorkspaceFileEdit
}

type WorkspaceFileResult = {
  success: boolean
  message: string
  data?: Record<string, unknown>
}

const EXT_TO_MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.pptx': PPTX_MIME,
  '.docx': DOCX_MIME,
  '.pdf': PDF_MIME,
}

export function inferContentType(fileName: string, explicitType?: string): string {
  if (explicitType) return explicitType
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  return EXT_TO_MIME[ext] || 'text/plain'
}

export function validateFlatWorkspaceFileName(fileName: string): string | null {
  const trimmed = fileName.trim()
  if (!trimmed) return 'File name cannot be empty'
  if (trimmed.includes('/')) {
    return 'Workspace files use a flat namespace. Use a plain file name like "report.csv", not a path like "files/reports/report.csv".'
  }
  return null
}

export interface DocumentFormatInfo {
  isDoc: boolean
  formatName?: 'PPTX' | 'DOCX' | 'PDF'
  sourceMime?: string
  taskId?: SandboxTaskId
}

export function getDocumentFormatInfo(fileName: string): DocumentFormatInfo {
  const lowerName = fileName.toLowerCase()
  if (lowerName.endsWith('.pptx')) {
    return {
      isDoc: true,
      formatName: 'PPTX',
      sourceMime: PPTX_SOURCE_MIME,
      taskId: 'pptx-generate',
    }
  }
  if (lowerName.endsWith('.docx')) {
    return {
      isDoc: true,
      formatName: 'DOCX',
      sourceMime: DOCX_SOURCE_MIME,
      taskId: 'docx-generate',
    }
  }
  if (lowerName.endsWith('.pdf')) {
    return {
      isDoc: true,
      formatName: 'PDF',
      sourceMime: PDF_SOURCE_MIME,
      taskId: 'pdf-generate',
    }
  }
  return { isDoc: false }
}

export const workspaceFileServerTool: BaseServerTool<WorkspaceFileArgs, WorkspaceFileResult> = {
  name: WorkspaceFile.id,
  async execute(
    params: WorkspaceFileArgs,
    context?: ServerToolContext
  ): Promise<WorkspaceFileResult> {
    const withMessageId = (message: string) =>
      context?.messageId ? `${message} [messageId:${context.messageId}]` : message

    if (!context?.userId) {
      logger.error('Unauthorized attempt to access workspace files')
      throw new Error('Authentication required')
    }

    const raw = params as Record<string, unknown>
    const nested = raw.args as Record<string, unknown> | undefined
    const normalized: WorkspaceFileArgs =
      params.operation && params.target
        ? params
        : nested && typeof nested === 'object'
          ? {
              operation: (nested.operation ?? raw.operation) as WorkspaceFileOperation,
              target: (nested.target ?? raw.target) as WorkspaceFileTarget | undefined,
              title: (nested.title ?? raw.title) as string | undefined,
              content: (nested.content ?? raw.content) as string | undefined,
              contentType: (nested.contentType ?? raw.contentType) as string | undefined,
              newName: (nested.newName ?? raw.newName) as string | undefined,
              edit: (nested.edit ?? raw.edit) as WorkspaceFileEdit | undefined,
            }
          : params
    const { operation } = normalized
    const workspaceId = context.workspaceId

    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }

    try {
      switch (operation) {
        case 'create': {
          const target = normalized.target
          if (!target || target.kind !== 'new_file') {
            return {
              success: false,
              message: 'create requires target.kind=new_file with target.fileName',
            }
          }

          const fileName = target.fileName
          const content = normalized.content ?? ''
          const explicitType = normalized.contentType
          const fileNameValidationError = validateFlatWorkspaceFileName(fileName)
          if (fileNameValidationError) return { success: false, message: fileNameValidationError }

          const existingFile = await getWorkspaceFileByName(workspaceId, fileName)
          if (existingFile) {
            return { success: false, message: `File "${fileName}" already exists` }
          }

          const docInfo = getDocumentFormatInfo(fileName)
          let contentType = inferContentType(fileName, explicitType)
          if (docInfo.isDoc) {
            try {
              await runSandboxTask(
                docInfo.taskId!,
                { code: content, workspaceId },
                { ownerKey: `user:${context.userId}`, signal: context.abortSignal }
              )
            } catch (err) {
              const msg = toError(err).message
              return {
                success: false,
                message: `${docInfo.formatName} generation failed: ${msg}. Fix the code and retry.`,
              }
            }
            contentType = docInfo.sourceMime!
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

          logger.info('Workspace file created via copilot', {
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

        case 'append': {
          const target = normalized.target
          if (!target || target.kind !== 'file_id') {
            return {
              success: false,
              message: 'append requires target.kind=file_id with target.fileId',
            }
          }

          const existingFile = await getWorkspaceFile(workspaceId, target.fileId)
          if (!existingFile) {
            return { success: false, message: `File with ID "${target.fileId}" not found` }
          }
          if (target.fileName && target.fileName !== existingFile.name) {
            return {
              success: false,
              message: `Target mismatch: fileId "${target.fileId}" is "${existingFile.name}", not "${target.fileName}"`,
            }
          }

          const currentBuffer = await downloadWsFile(existingFile)
          await storeFileIntent(workspaceId, target.fileId, {
            operation: 'append',
            fileId: target.fileId,
            workspaceId,
            userId: context.userId,
            chatId: context.chatId,
            messageId: context.messageId,
            fileRecord: existingFile,
            existingContent: currentBuffer.toString('utf-8'),
            contentType: normalized.contentType,
            title: normalized.title,
            createdAt: Date.now(),
          })

          return {
            success: true,
            message: withMessageId(
              `Intent set: append to "${existingFile.name}". Wait for this success result, then call edit_content in the next step with the content to write. Do not call edit_content in parallel.`
            ),
            data: { id: existingFile.id, name: existingFile.name, operation: 'append' },
          }
        }

        case 'update': {
          const target = normalized.target
          if (!target || target.kind !== 'file_id') {
            return {
              success: false,
              message: 'update requires target.kind=file_id with target.fileId',
            }
          }

          const fileRecord = await getWorkspaceFile(workspaceId, target.fileId)
          if (!fileRecord) {
            return { success: false, message: `File with ID "${target.fileId}" not found` }
          }
          if (target.fileName && target.fileName !== fileRecord.name) {
            return {
              success: false,
              message: `Target mismatch: fileId "${target.fileId}" is "${fileRecord.name}", not "${target.fileName}"`,
            }
          }

          await storeFileIntent(workspaceId, target.fileId, {
            operation: 'update',
            fileId: target.fileId,
            workspaceId,
            userId: context.userId,
            chatId: context.chatId,
            messageId: context.messageId,
            fileRecord,
            contentType: normalized.contentType,
            title: normalized.title,
            createdAt: Date.now(),
          })

          return {
            success: true,
            message: withMessageId(
              `Intent set: update "${fileRecord.name}". Wait for this success result, then call edit_content in the next step with the replacement content. Do not call edit_content in parallel.`
            ),
            data: { id: target.fileId, name: fileRecord.name, operation: 'update' },
          }
        }

        case 'rename': {
          const target = normalized.target
          if (!target || target.kind !== 'file_id') {
            return {
              success: false,
              message: 'rename requires target.kind=file_id with target.fileId',
            }
          }
          if (!normalized.newName) {
            return { success: false, message: 'newName is required for rename operation' }
          }
          const fileNameValidationError = validateFlatWorkspaceFileName(normalized.newName)
          if (fileNameValidationError) return { success: false, message: fileNameValidationError }

          const fileRecord = await getWorkspaceFile(workspaceId, target.fileId)
          if (!fileRecord) {
            return { success: false, message: `File with ID "${target.fileId}" not found` }
          }

          const oldName = fileRecord.name
          assertServerToolNotAborted(context)
          await renameWorkspaceFile(workspaceId, target.fileId, normalized.newName)

          logger.info('Workspace file renamed via copilot', {
            fileId: target.fileId,
            oldName,
            newName: normalized.newName,
            userId: context.userId,
          })

          return {
            success: true,
            message: `File renamed from "${oldName}" to "${normalized.newName}"`,
            data: { id: target.fileId, name: normalized.newName },
          }
        }

        case 'delete': {
          const target = normalized.target
          if (!target || target.kind !== 'file_id') {
            return {
              success: false,
              message: 'delete requires target.kind=file_id with target.fileId',
            }
          }

          const fileRecord = await getWorkspaceFile(workspaceId, target.fileId)
          if (!fileRecord) {
            return { success: false, message: `File with ID "${target.fileId}" not found` }
          }

          assertServerToolNotAborted(context)
          await deleteWorkspaceFile(workspaceId, target.fileId)

          logger.info('Workspace file deleted via copilot', {
            fileId: target.fileId,
            name: fileRecord.name,
            userId: context.userId,
          })

          return {
            success: true,
            message: `File "${fileRecord.name}" deleted successfully`,
            data: { id: target.fileId, name: fileRecord.name },
          }
        }

        case 'patch': {
          const target = normalized.target
          if (!target || target.kind !== 'file_id') {
            return {
              success: false,
              message: 'patch requires target.kind=file_id with target.fileId',
            }
          }
          if (!normalized.edit) {
            return { success: false, message: 'edit is required for patch operation' }
          }

          const fileRecord = await getWorkspaceFile(workspaceId, target.fileId)
          if (!fileRecord) {
            return { success: false, message: `File with ID "${target.fileId}" not found` }
          }

          const currentBuffer = await downloadWsFile(fileRecord)
          const existingContent = currentBuffer.toString('utf-8')

          if (normalized.edit.strategy === 'search_replace') {
            const search = normalized.edit.search
            const firstIdx = existingContent.indexOf(search)
            if (firstIdx === -1) {
              return {
                success: false,
                message: `Patch failed: search string not found in file "${fileRecord.name}". Search: "${search.slice(0, 100)}${search.length > 100 ? '...' : ''}"`,
              }
            }
            if (
              !normalized.edit.replaceAll &&
              existingContent.indexOf(search, firstIdx + 1) !== -1
            ) {
              return {
                success: false,
                message: `Patch failed: search string is ambiguous — found at multiple locations in "${fileRecord.name}". Use a longer unique search string or replaceAll.`,
              }
            }
          } else if (normalized.edit.strategy === 'anchored') {
            if (!normalized.edit.mode) {
              return { success: false, message: 'anchored strategy requires mode' }
            }
          } else {
            return {
              success: false,
              message: `Unknown patch strategy: "${(normalized.edit as { strategy?: string }).strategy}"`,
            }
          }

          await storeFileIntent(workspaceId, target.fileId, {
            operation: 'patch',
            fileId: target.fileId,
            workspaceId,
            userId: context.userId,
            chatId: context.chatId,
            messageId: context.messageId,
            fileRecord,
            existingContent,
            edit: {
              strategy: normalized.edit.strategy,
              ...(normalized.edit.strategy === 'search_replace'
                ? {
                    search: normalized.edit.search,
                    replaceAll: normalized.edit.replaceAll,
                  }
                : {
                    mode: normalized.edit.mode,
                    occurrence: normalized.edit.occurrence,
                    before_anchor: normalized.edit.before_anchor,
                    after_anchor: normalized.edit.after_anchor,
                    anchor: normalized.edit.anchor,
                    start_anchor: normalized.edit.start_anchor,
                    end_anchor: normalized.edit.end_anchor,
                  }),
            },
            contentType: normalized.contentType,
            title: normalized.title,
            createdAt: Date.now(),
          })

          return {
            success: true,
            message: withMessageId(
              `Intent set: patch "${fileRecord.name}" (${normalized.edit.strategy}). Wait for this success result, then call edit_content in the next step with the replacement/insert content. Do not call edit_content in parallel.`
            ),
            data: { id: target.fileId, name: fileRecord.name, operation: 'patch' },
          }
        }

        default:
          return {
            success: false,
            message: `Unknown operation: ${operation}. Supported: create, append, update, patch, rename, delete.`,
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
