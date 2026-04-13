import { createLogger } from '@sim/logger'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  generateDocxFromCode,
  generatePdfFromCode,
  generatePptxFromCode,
} from '@/lib/execution/doc-vm'
import { updateWorkspaceFileContent } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { consumeLatestFileIntent } from './file-intent-store'
import { inferContentType } from './workspace-file'

const logger = createLogger('EditContentServerTool')

type EditContentArgs = {
  content: string
}

type EditContentResult = {
  success: boolean
  message: string
  data?: Record<string, unknown>
}

function getDocumentFormatInfo(fileName: string): {
  isDoc: boolean
  formatName?: string
  sourceMime?: string
  generator?: (code: string, workspaceId: string, signal?: AbortSignal) => Promise<Buffer>
} {
  const lowerName = fileName.toLowerCase()
  if (lowerName.endsWith('.pptx')) {
    return {
      isDoc: true,
      formatName: 'PPTX',
      sourceMime: 'text/x-pptxgenjs',
      generator: generatePptxFromCode,
    }
  }
  if (lowerName.endsWith('.docx')) {
    return {
      isDoc: true,
      formatName: 'DOCX',
      sourceMime: 'text/x-docxjs',
      generator: generateDocxFromCode,
    }
  }
  if (lowerName.endsWith('.pdf')) {
    return {
      isDoc: true,
      formatName: 'PDF',
      sourceMime: 'text/x-pdflibjs',
      generator: generatePdfFromCode,
    }
  }
  return { isDoc: false }
}

export const editContentServerTool: BaseServerTool<EditContentArgs, EditContentResult> = {
  name: 'edit_content',
  async execute(params: EditContentArgs, context?: ServerToolContext): Promise<EditContentResult> {
    if (!context?.userId) {
      logger.error('Unauthorized attempt to use edit_content')
      throw new Error('Authentication required')
    }

    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }

    const raw = params as Record<string, unknown>
    const nested = raw.args as Record<string, unknown> | undefined
    const content =
      typeof params.content === 'string'
        ? params.content
        : typeof nested?.content === 'string'
          ? (nested.content as string)
          : undefined

    if (content === undefined) {
      return { success: false, message: 'content is required for edit_content' }
    }

    const intent = await consumeLatestFileIntent(workspaceId, {
      chatId: context.chatId,
      messageId: context.messageId,
    })
    if (!intent) {
      return {
        success: false,
        message:
          'No workspace_file context found. Call workspace_file first, wait for it to succeed, then call edit_content in the next step. Do not emit edit_content in parallel or in the same batch as workspace_file.',
      }
    }

    try {
      const { operation, fileRecord } = intent
      const docInfo = getDocumentFormatInfo(fileRecord.name)

      let finalContent: string
      switch (operation) {
        case 'append': {
          const existing = intent.existingContent ?? ''
          finalContent = docInfo.isDoc
            ? existing
              ? `${existing}\n{\n${content}\n}`
              : content
            : existing
              ? `${existing}\n${content}`
              : content
          break
        }
        case 'update': {
          finalContent = content
          break
        }
        case 'patch': {
          const existing = intent.existingContent ?? ''
          if (!intent.edit) {
            return { success: false, message: 'Patch intent missing edit metadata' }
          }

          if (intent.edit.strategy === 'search_replace') {
            const search = intent.edit.search!
            const firstIdx = existing.indexOf(search)
            if (firstIdx === -1) {
              return {
                success: false,
                message: `Patch failed: search string not found in file "${fileRecord.name}"`,
              }
            }
            finalContent = intent.edit.replaceAll
              ? existing.split(search).join(content)
              : existing.slice(0, firstIdx) + content + existing.slice(firstIdx + search.length)
          } else if (intent.edit.strategy === 'anchored') {
            const lines = existing.split('\n')
            const defaultOccurrence = intent.edit.occurrence ?? 1

            const findAnchorLine = (
              anchor: string,
              occurrence = defaultOccurrence,
              afterIndex = -1
            ): { index: number; error?: string } => {
              const trimmed = anchor.trim()
              let count = 0
              for (let i = afterIndex + 1; i < lines.length; i++) {
                if (lines[i].trim() === trimmed) {
                  count++
                  if (count === occurrence) return { index: i }
                }
              }
              if (count === 0) {
                return {
                  index: -1,
                  error: `Anchor line not found in "${fileRecord.name}": "${anchor.slice(0, 100)}"`,
                }
              }
              return {
                index: -1,
                error: `Anchor line occurrence ${occurrence} not found (only ${count} match${count > 1 ? 'es' : ''}) in "${fileRecord.name}": "${anchor.slice(0, 100)}"`,
              }
            }

            if (intent.edit.mode === 'replace_between') {
              if (!intent.edit.before_anchor || !intent.edit.after_anchor) {
                return {
                  success: false,
                  message: 'replace_between requires before_anchor and after_anchor',
                }
              }
              const before = findAnchorLine(intent.edit.before_anchor)
              if (before.error) return { success: false, message: `Patch failed: ${before.error}` }
              const after = findAnchorLine(
                intent.edit.after_anchor,
                defaultOccurrence,
                before.index
              )
              if (after.error) return { success: false, message: `Patch failed: ${after.error}` }
              if (after.index <= before.index) {
                return {
                  success: false,
                  message: 'Patch failed: after_anchor must appear after before_anchor in the file',
                }
              }
              const newLines = [
                ...lines.slice(0, before.index + 1),
                ...content.split('\n'),
                ...lines.slice(after.index),
              ]
              finalContent = newLines.join('\n')
            } else if (intent.edit.mode === 'insert_after') {
              if (!intent.edit.anchor) {
                return { success: false, message: 'insert_after requires anchor' }
              }
              const found = findAnchorLine(intent.edit.anchor)
              if (found.error) return { success: false, message: `Patch failed: ${found.error}` }
              const newLines = [
                ...lines.slice(0, found.index + 1),
                ...content.split('\n'),
                ...lines.slice(found.index + 1),
              ]
              finalContent = newLines.join('\n')
            } else if (intent.edit.mode === 'delete_between') {
              if (!intent.edit.start_anchor || !intent.edit.end_anchor) {
                return {
                  success: false,
                  message: 'delete_between requires start_anchor and end_anchor',
                }
              }
              const start = findAnchorLine(intent.edit.start_anchor)
              if (start.error) return { success: false, message: `Patch failed: ${start.error}` }
              const end = findAnchorLine(intent.edit.end_anchor, defaultOccurrence, start.index)
              if (end.error) return { success: false, message: `Patch failed: ${end.error}` }
              if (end.index <= start.index) {
                return {
                  success: false,
                  message: 'Patch failed: end_anchor must appear after start_anchor in the file',
                }
              }
              const newLines = [...lines.slice(0, start.index), ...lines.slice(end.index)]
              finalContent = newLines.join('\n')
            } else {
              return {
                success: false,
                message: `Unknown anchored patch mode: "${intent.edit.mode}"`,
              }
            }
          } else {
            return { success: false, message: `Unknown patch strategy: "${intent.edit.strategy}"` }
          }
          break
        }
        default:
          return { success: false, message: `Unsupported operation in intent: ${operation}` }
      }

      if (docInfo.isDoc) {
        try {
          await docInfo.generator!(finalContent, workspaceId)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return {
            success: false,
            message: `${docInfo.formatName} generation failed: ${msg}. Fix the content and retry.`,
          }
        }
      }

      const fileBuffer = Buffer.from(finalContent, 'utf-8')
      assertServerToolNotAborted(context)
      const mime = docInfo.sourceMime || inferContentType(fileRecord.name, intent.contentType)
      await updateWorkspaceFileContent(workspaceId, intent.fileId, context.userId, fileBuffer, mime)

      const verb =
        operation === 'append' ? 'appended to' : operation === 'update' ? 'updated' : 'patched'
      logger.info(`Workspace file ${verb} via copilot (edit_content)`, {
        fileId: intent.fileId,
        name: fileRecord.name,
        operation,
        size: fileBuffer.length,
        userId: context.userId,
      })

      return {
        success: true,
        message: `File "${fileRecord.name}" ${verb} successfully (${fileBuffer.length} bytes)`,
        data: {
          id: intent.fileId,
          name: fileRecord.name,
          size: fileBuffer.length,
          contentType: mime,
        },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      logger.error('Error in edit_content tool', {
        operation: intent.operation,
        fileId: intent.fileId,
        error: errorMessage,
        userId: context.userId,
      })
      return {
        success: false,
        message: `Failed to apply content: ${errorMessage}`,
      }
    }
  },
}
