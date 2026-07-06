import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { WorkspaceFile } from '@/lib/copilot/generated/tool-catalog-v1'
import { ensureWorkspaceAccess } from '@/lib/copilot/tools/handlers/access'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { isOutputsPath } from '@/lib/copilot/vfs/path-utils'
import { ensureWorkflowAliasBacking } from '@/lib/copilot/vfs/workflow-alias-backing'
import { resolveWorkflowAliasForWorkspace } from '@/lib/copilot/vfs/workflow-alias-resolver'
import { isPlanAliasPath } from '@/lib/copilot/vfs/workflow-aliases'
import { isE2BDocEnabled } from '@/lib/core/config/env-flags'
import { runSandboxTask } from '@/lib/execution/sandbox/run-task'
import { ensureWorkspaceFileFolderPath } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  fetchWorkspaceFileBuffer as downloadWsFile,
  getWorkspaceFile,
  getWorkspaceFileByName,
  resolveWorkspaceFileReference,
  uploadWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  performDeleteWorkspaceFileItems,
  performRenameWorkspaceFile,
} from '@/lib/workspace-files/orchestration'
import type { SandboxTaskId } from '@/sandbox-tasks/registry'
import {
  compileDoc,
  DOCXJS_SOURCE_MIME,
  DocCompileUserError,
  getE2BDocFormat,
  PPTXGENJS_SOURCE_MIME,
} from './doc-compile'
import { buildEmbeddedImageRefWarning } from './embedded-image-refs'
import { storeFileIntent } from './file-intent-store'

const logger = createLogger('WorkspaceFileServerTool')

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PDF_MIME = 'application/pdf'
// Single source of the JS source MIMEs is doc-compile.ts; reuse to avoid drift.
const PPTX_SOURCE_MIME = PPTXGENJS_SOURCE_MIME
const DOCX_SOURCE_MIME = DOCXJS_SOURCE_MIME
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
  | {
      kind: 'path'
      path: string
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
  const segments = trimmed.split('/').map((segment) => segment.trim())
  if (segments.some((segment) => !segment)) {
    return 'File path cannot contain empty segments'
  }
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\\'))) {
    return 'File path cannot contain dot segments or backslashes'
  }
  return null
}

export function splitWorkspaceFilePath(fileName: string): {
  folderSegments: string[]
  leafName: string
} {
  const segments = fileName
    .trim()
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
  return {
    folderSegments: segments.slice(0, -1),
    leafName: segments[segments.length - 1] ?? '',
  }
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

export type CompileForWriteResult =
  | { ok: true; sourceMime: string }
  | { ok: false; message: string }

/**
 * Shared write-time doc handling for create + edit_content: validates and builds
 * the document (E2B doc sandbox when enabled — Node pptx/docx, Python pdf/xlsx —
 * else isolated-vm JS) and returns the source MIME to store, or a user-facing
 * failure message. Non-doc files resolve to `fallbackMime`. Compilation happens
 * here exactly once per write; the artifact is content-addressed so a read can
 * later just load it.
 */
export async function compileDocForWrite(args: {
  source: string
  fileName: string
  workspaceId: string
  ownerKey: string
  signal?: AbortSignal
  fallbackMime: string
}): Promise<CompileForWriteResult> {
  const { source, fileName, workspaceId, ownerKey, signal, fallbackMime } = args
  const docInfo = getDocumentFormatInfo(fileName)
  const e2bFmt = isE2BDocEnabled ? await getE2BDocFormat(fileName) : null

  if (!e2bFmt && fileName.toLowerCase().endsWith('.xlsx')) {
    return {
      ok: false,
      message: isE2BDocEnabled
        ? 'Excel (.xlsx) generation is currently behind the mothership-beta feature flag and is not available.'
        : 'Excel (.xlsx) generation requires the E2B document sandbox, which is not enabled in this environment.',
    }
  }

  if (e2bFmt) {
    // compileDoc is load-or-build, so an identical re-write reuses the cached
    // binary instead of re-running E2B.
    try {
      await compileDoc({ source, fileName, workspaceId })
    } catch (err) {
      if (err instanceof DocCompileUserError) {
        return {
          ok: false,
          message: `${e2bFmt.formatName} generation failed: ${err.message}. Fix the code and retry.`,
        }
      }
      return {
        ok: false,
        message: `${e2bFmt.formatName} generation failed due to a system error: ${toError(err).message}. Retry shortly.`,
      }
    }
    return { ok: true, sourceMime: e2bFmt.sourceMime }
  }

  if (docInfo.isDoc) {
    try {
      await runSandboxTask(docInfo.taskId!, { code: source, workspaceId }, { ownerKey, signal })
    } catch (err) {
      return {
        ok: false,
        message: `${docInfo.formatName} generation failed: ${toError(err).message}. Fix the code and retry.`,
      }
    }
    return { ok: true, sourceMime: docInfo.sourceMime! }
  }

  return { ok: true, sourceMime: fallbackMime }
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

    const resolveExistingTarget = async (
      target: WorkspaceFileTarget | undefined,
      operationName: string
    ): Promise<{ fileRecord?: WorkspaceFileRecord; vfsPath?: string; error?: string }> => {
      if (!target || (target.kind !== 'path' && target.kind !== 'file_id')) {
        return { error: `${operationName} requires target.kind=path with target.path` }
      }
      if (target.kind === 'path' && isOutputsPath(target.path)) {
        return {
          error: `${operationName} cannot target outputs/. outputs/ files are not editable — materialize the file to files/ first, then edit it there.`,
        }
      }
      let fileRecord: WorkspaceFileRecord | null = null
      let vfsPath: string | undefined
      if (target.kind === 'path') {
        const alias = await resolveWorkflowAliasForWorkspace({
          workspaceId: workspaceId!,
          path: target.path,
        })
        if (!alias && isPlanAliasPath(target.path)) {
          return { error: `Unsupported plan alias path or missing workflow: ${target.path}` }
        }
        if (alias) {
          if (alias.kind === 'plans_dir') {
            return { error: `Plan alias directory is not a file: ${target.path}` }
          }
          fileRecord = await resolveWorkspaceFileReference(workspaceId!, alias.backingPath)
          if (!fileRecord && alias.kind === 'changelog') {
            await ensureWorkflowAliasBacking({
              workspaceId: workspaceId!,
              userId: context.userId,
              workflowId: alias.workflowId,
              workflowName: alias.workflowName,
            })
            fileRecord = await resolveWorkspaceFileReference(workspaceId!, alias.backingPath)
          }
          vfsPath = alias.aliasPath
        } else {
          fileRecord = await resolveWorkspaceFileReference(workspaceId!, target.path)
          vfsPath = target.path
        }
      } else {
        fileRecord = await getWorkspaceFile(workspaceId!, target.fileId)
      }
      if (!fileRecord) {
        const ref = target.kind === 'path' ? target.path : target.fileId
        return { error: `File not found: ${ref}` }
      }
      if (target.fileName && target.fileName !== fileRecord.name) {
        return {
          error: `Target mismatch: "${target.fileName}" does not match resolved file "${fileRecord.name}"`,
        }
      }
      return { fileRecord, vfsPath }
    }

    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }

    try {
      await ensureWorkspaceAccess(workspaceId, context.userId, 'write')

      switch (operation) {
        case 'create': {
          const target = normalized.target
          if (!target || target.kind !== 'new_file') {
            return {
              success: false,
              message: 'create requires target.kind=new_file with target.fileName',
            }
          }
          if (isOutputsPath(target.fileName)) {
            return {
              success: false,
              message:
                'workspace_file cannot create files under outputs/. outputs/ holds single-shot generated files and is not editable; create editable files under files/ instead.',
            }
          }

          const { folderSegments, leafName } = splitWorkspaceFilePath(target.fileName)
          const fileName = leafName
          const content = normalized.content ?? ''
          const explicitType = normalized.contentType
          const fileNameValidationError = validateFlatWorkspaceFileName(target.fileName)
          if (fileNameValidationError) return { success: false, message: fileNameValidationError }

          const folderId = await ensureWorkspaceFileFolderPath({
            workspaceId,
            userId: context.userId,
            pathSegments: folderSegments,
          })
          const existingFile = await getWorkspaceFileByName(workspaceId, fileName, { folderId })
          if (existingFile) {
            return { success: false, message: `File "${target.fileName}" already exists` }
          }

          const compiled = await compileDocForWrite({
            source: content,
            fileName,
            workspaceId,
            ownerKey: `user:${context.userId}`,
            signal: context.abortSignal,
            fallbackMime: inferContentType(fileName, explicitType),
          })
          if (!compiled.ok) {
            return { success: false, message: compiled.message }
          }
          const contentType = compiled.sourceMime

          const fileBuffer = Buffer.from(content, 'utf-8')
          assertServerToolNotAborted(context)
          const result = await uploadWorkspaceFile(
            workspaceId,
            context.userId,
            fileBuffer,
            fileName,
            contentType,
            { folderId }
          )
          logger.info('Workspace file created via copilot', {
            fileId: result.id,
            name: fileName,
            size: fileBuffer.length,
            contentType,
            userId: context.userId,
          })

          const embedWarning = await buildEmbeddedImageRefWarning(content, workspaceId)

          return {
            success: true,
            message: `File "${fileName}" created successfully (${fileBuffer.length} bytes)${embedWarning}`,
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
          const {
            fileRecord: existingFile,
            vfsPath,
            error,
          } = await resolveExistingTarget(target, 'append')
          if (error || !existingFile) return { success: false, message: error || 'File not found' }

          const currentBuffer = await downloadWsFile(existingFile)
          await storeFileIntent(workspaceId, existingFile.id, {
            operation: 'append',
            fileId: existingFile.id,
            workspaceId,
            userId: context.userId,
            chatId: context.chatId,
            messageId: context.messageId,
            channelId: context.parentToolCallId,
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
            data: { id: existingFile.id, name: existingFile.name, vfsPath, operation: 'append' },
          }
        }

        case 'update': {
          const target = normalized.target
          const { fileRecord, vfsPath, error } = await resolveExistingTarget(target, 'update')
          if (error || !fileRecord) return { success: false, message: error || 'File not found' }

          await storeFileIntent(workspaceId, fileRecord.id, {
            operation: 'update',
            fileId: fileRecord.id,
            workspaceId,
            userId: context.userId,
            chatId: context.chatId,
            messageId: context.messageId,
            channelId: context.parentToolCallId,
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
            data: { id: fileRecord.id, name: fileRecord.name, vfsPath, operation: 'update' },
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
          const result = await performRenameWorkspaceFile({
            workspaceId,
            fileId: target.fileId,
            name: normalized.newName,
            userId: context.userId,
          })
          if (!result.success) {
            return { success: false, message: result.error || 'Failed to rename file' }
          }

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
          const result = await performDeleteWorkspaceFileItems({
            workspaceId,
            userId: context.userId,
            fileIds: [target.fileId],
          })
          if (!result.success) {
            return { success: false, message: result.error || 'Failed to delete file' }
          }

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
          if (!normalized.edit) {
            return { success: false, message: 'edit is required for patch operation' }
          }

          const { fileRecord, vfsPath, error } = await resolveExistingTarget(target, 'patch')
          if (error || !fileRecord) return { success: false, message: error || 'File not found' }

          const currentBuffer = await downloadWsFile(fileRecord)
          const existingContent = currentBuffer.toString('utf-8')

          if (normalized.edit.strategy === 'search_replace') {
            const search = normalized.edit.search
            const firstIdx = existingContent.indexOf(search)
            if (firstIdx === -1) {
              return {
                success: false,
                message: `Patch failed: search string not found in file "${fileRecord.name}". Search: "${truncate(search, 100)}"`,
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

          await storeFileIntent(workspaceId, fileRecord.id, {
            operation: 'patch',
            fileId: fileRecord.id,
            workspaceId,
            userId: context.userId,
            chatId: context.chatId,
            messageId: context.messageId,
            channelId: context.parentToolCallId,
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
            data: { id: fileRecord.id, name: fileRecord.name, vfsPath, operation: 'patch' },
          }
        }

        default:
          return {
            success: false,
            message: `Unknown operation: ${operation}. Supported: create, append, update, patch, rename, delete.`,
          }
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Unknown error occurred')
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
