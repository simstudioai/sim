import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { TOOL_RESULT_MAX_INLINE_CHARS } from '@/lib/copilot/constants'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { getOrMaterializeVFS } from '@/lib/copilot/vfs'
import { listChatUploads, readChatUpload } from './upload-file-reader'

const logger = createLogger('VfsTools')

function serializedResultSize(value: unknown): number {
  try {
    return JSON.stringify(value).length
  } catch {
    return String(value).length
  }
}

function isOversizedReadPlaceholder(content: string): boolean {
  return (
    content.startsWith('[File too large to display inline:') ||
    content.startsWith('[Image too large:')
  )
}

function hasImageAttachment(result: unknown): boolean {
  if (!result || typeof result !== 'object') {
    return false
  }
  const attachment = (result as { attachment?: { type?: string } }).attachment
  return attachment?.type === 'image'
}

export async function executeVfsGrep(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const pattern = params.pattern as string | undefined
  if (!pattern) {
    return { success: false, error: "Missing required parameter 'pattern'" }
  }
  const outputMode = (params.output_mode as string) ?? 'content'

  const workspaceId = context.workspaceId
  if (!workspaceId) {
    return { success: false, error: 'No workspace context available' }
  }

  try {
    const vfs = await getOrMaterializeVFS(workspaceId, context.userId)
    const result = vfs.grep(pattern, params.path as string | undefined, {
      maxResults: (params.maxResults as number) ?? 50,
      outputMode: outputMode as 'content' | 'files_with_matches' | 'count',
      ignoreCase: (params.ignoreCase as boolean) ?? false,
      lineNumbers: (params.lineNumbers as boolean) ?? true,
      context: (params.context as number) ?? 0,
    })
    const key =
      outputMode === 'files_with_matches' ? 'files' : outputMode === 'count' ? 'counts' : 'matches'
    const matchCount = Array.isArray(result)
      ? result.length
      : typeof result === 'object'
        ? Object.keys(result).length
        : 0
    const output = { [key]: result }
    if (serializedResultSize(output) > TOOL_RESULT_MAX_INLINE_CHARS) {
      return {
        success: false,
        error:
          'Grep result too large to return inline. Retry grep with a more specific pattern or narrower path, and reduce context or maxResults. Avoid catch-all greps because smaller searches save context window and make follow-up reads cheaper.',
      }
    }
    logger.debug('vfs_grep result', { pattern, path: params.path, outputMode, matchCount })
    return { success: true, output }
  } catch (err) {
    logger.error('vfs_grep failed', {
      pattern,
      path: params.path,
      error: toError(err).message,
    })
    return { success: false, error: err instanceof Error ? err.message : 'vfs_grep failed' }
  }
}

export async function executeVfsGlob(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const pattern = params.pattern as string | undefined
  if (!pattern) {
    return { success: false, error: "Missing required parameter 'pattern'" }
  }

  const workspaceId = context.workspaceId
  if (!workspaceId) {
    return { success: false, error: 'No workspace context available' }
  }

  try {
    const vfs = await getOrMaterializeVFS(workspaceId, context.userId)
    let files = vfs.glob(pattern)

    if (context.chatId && (pattern === 'uploads/*' || pattern.startsWith('uploads/'))) {
      const uploads = await listChatUploads(context.chatId)
      const uploadPaths = uploads.map((f) => `uploads/${f.name}`)
      files = [...files, ...uploadPaths]
    }

    logger.debug('vfs_glob result', { pattern, fileCount: files.length })
    return { success: true, output: { files } }
  } catch (err) {
    logger.error('vfs_glob failed', {
      pattern,
      error: toError(err).message,
    })
    return { success: false, error: err instanceof Error ? err.message : 'vfs_glob failed' }
  }
}

export async function executeVfsRead(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const path = params.path as string | undefined
  if (!path) {
    return { success: false, error: "Missing required parameter 'path'" }
  }

  const workspaceId = context.workspaceId
  if (!workspaceId) {
    return { success: false, error: 'No workspace context available' }
  }

  try {
    const parseOptionalNumber = (value: unknown): number | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number.parseInt(value, 10)
        return Number.isFinite(parsed) ? parsed : undefined
      }
      return undefined
    }
    const offset = parseOptionalNumber(params.offset)
    const limit = parseOptionalNumber(params.limit)
    const applyWindow = <T extends { content: string; totalLines: number }>(result: T): T => {
      if (offset === undefined && limit === undefined) return result
      const lines = result.content.split('\n')
      const start = Math.max(0, Math.min(result.totalLines, offset ?? 0))
      const endRaw = limit !== undefined ? start + Math.max(0, limit) : result.totalLines
      const end = Math.max(start, Math.min(result.totalLines, endRaw))
      return {
        ...result,
        content: lines.slice(start, end).join('\n'),
      }
    }

    // Handle chat-scoped uploads via the uploads/ virtual prefix
    if (path.startsWith('uploads/')) {
      if (!context.chatId) {
        return { success: false, error: 'No chat context available for uploads/' }
      }
      const filename = path.slice('uploads/'.length)
      const uploadResult = await readChatUpload(filename, context.chatId)
      if (uploadResult) {
        const isImage = hasImageAttachment(uploadResult)
        if (
          !isImage &&
          (isOversizedReadPlaceholder(uploadResult.content) ||
            serializedResultSize(uploadResult) > TOOL_RESULT_MAX_INLINE_CHARS)
        ) {
          logger.warn('Upload read result too large', {
            path,
            hasAttachment: isImage,
            contentLength: uploadResult.content.length,
            serializedSize: serializedResultSize(uploadResult),
          })
          return {
            success: false,
            error: isOversizedReadPlaceholder(uploadResult.content)
              ? uploadResult.content
              : 'Read result too large to return inline. Use grep with a more specific pattern or narrower path to locate the relevant section, then retry read with offset/limit. Avoid catch-all greps or full-file reads because they waste context window.',
          }
        }
        const windowedUpload = applyWindow(uploadResult)
        logger.debug('vfs_read resolved chat upload', {
          path,
          totalLines: uploadResult.totalLines,
          hasAttachment: isImage,
          offset,
          limit,
        })
        return { success: true, output: windowedUpload }
      }
      return {
        success: false,
        error: `Upload not found: ${path}. Use glob("uploads/*") to list available uploads.`,
      }
    }

    const vfs = await getOrMaterializeVFS(workspaceId, context.userId)

    // For workspace file paths (files/ or recently-deleted/files/), try readFileContent
    // first so images, PDFs, and documents get proper attachment/parsing handling rather
    // than being served as raw VFS metadata text.
    const fileContent = await vfs.readFileContent(path)
    if (fileContent) {
      const isImage = hasImageAttachment(fileContent)
      if (
        !isImage &&
        (isOversizedReadPlaceholder(fileContent.content) ||
          serializedResultSize(fileContent) > TOOL_RESULT_MAX_INLINE_CHARS)
      ) {
        logger.warn('File read result too large', {
          path,
          hasAttachment: isImage,
          contentLength: fileContent.content.length,
          serializedSize: serializedResultSize(fileContent),
        })
        return {
          success: false,
          error: isOversizedReadPlaceholder(fileContent.content)
            ? fileContent.content
            : 'Read result too large to return inline. Use grep with a more specific pattern or narrower path to locate the relevant section, then retry read with offset/limit. Avoid catch-all greps or full-file reads because they waste context window.',
        }
      }
      const windowedFileContent = applyWindow(fileContent)
      logger.debug('vfs_read resolved workspace file', {
        path,
        totalLines: fileContent.totalLines,
        hasAttachment: isImage,
        offset,
        limit,
      })
      return {
        success: true,
        output: windowedFileContent,
      }
    }

    const result = vfs.read(path, offset, limit)
    if (!result) {
      const suggestions = vfs.suggestSimilar(path)
      logger.warn('vfs_read file not found', { path, suggestions })
      const hint =
        suggestions.length > 0
          ? ` Did you mean: ${suggestions.join(', ')}?`
          : ' Use glob to discover available paths.'
      return { success: false, error: `File not found: ${path}.${hint}` }
    }
    if (
      !hasImageAttachment(result) &&
      (isOversizedReadPlaceholder(result.content) ||
        serializedResultSize(result) > TOOL_RESULT_MAX_INLINE_CHARS)
    ) {
      return {
        success: false,
        error:
          'Read result too large to return inline. Use grep with a more specific pattern or narrower path to locate the relevant section, then retry read with offset/limit. Avoid catch-all greps or full-file reads because they waste context window.',
      }
    }
    logger.debug('vfs_read result', { path, totalLines: result.totalLines, offset, limit })
    return {
      success: true,
      output: result,
    }
  } catch (err) {
    logger.error('vfs_read failed', {
      path,
      error: toError(err).message,
    })
    return { success: false, error: err instanceof Error ? err.message : 'vfs_read failed' }
  }
}

export async function executeVfsList(
  params: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const path = params.path as string | undefined
  if (!path) {
    return { success: false, error: "Missing required parameter 'path'" }
  }

  const workspaceId = context.workspaceId
  if (!workspaceId) {
    return { success: false, error: 'No workspace context available' }
  }

  try {
    const vfs = await getOrMaterializeVFS(workspaceId, context.userId)
    const entries = vfs.list(path)
    logger.debug('vfs_list result', { path, entryCount: entries.length })
    return { success: true, output: { entries } }
  } catch (err) {
    logger.error('vfs_list failed', {
      path,
      error: toError(err).message,
    })
    return { success: false, error: err instanceof Error ? err.message : 'vfs_list failed' }
  }
}
