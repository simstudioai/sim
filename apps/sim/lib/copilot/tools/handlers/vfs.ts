import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { getBlockVisibilityForCopilot } from '@/lib/copilot/block-visibility'
import { TOOL_RESULT_MAX_INLINE_CHARS } from '@/lib/copilot/constants'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { getOrMaterializeVFS } from '@/lib/copilot/vfs'
import type { GrepCountEntry, GrepMatch } from '@/lib/copilot/vfs/operations'
import { WorkspaceFileGrepError } from '@/lib/copilot/vfs/operations'
import { encodeVfsSegment } from '@/lib/copilot/vfs/path-utils'
import { withBlockVisibility } from '@/blocks/visibility/server-context'
import { grepChatUpload, listChatUploads, readChatUpload } from './upload-file-reader'

const logger = createLogger('VfsTools')

/**
 * Materialize the workspace VFS inside the viewer's block-visibility context so
 * the static component files stamped into it exclude blocks gated for this
 * viewer (unrevealed previews, kill-switched types). Visibility is memoized per
 * (userId, workspaceId), so repeated tool calls in one turn resolve once.
 */
async function getGatedVFS(workspaceId: string, userId: string) {
  const vis = await getBlockVisibilityForCopilot(userId, workspaceId)
  return withBlockVisibility(vis, () => getOrMaterializeVFS(workspaceId, userId))
}

/**
 * Encode a chat-upload display name as a single canonical VFS path segment so
 * `uploads/` paths follow the same percent-encoded convention as `files/`.
 * Falls back to the raw name if the segment cannot be encoded (so a listing
 * never fails wholesale over one odd name).
 */
function encodeUploadSegment(name: string): string {
  try {
    return encodeVfsSegment(name)
  } catch {
    return name
  }
}

/**
 * True when a grep `path` targets the workspace files tree (`files/` or
 * `recently-deleted/files/`). Such greps search a single file's content via
 * {@link WorkspaceVFS.grepFile}; every other path searches the VFS map.
 */
function isWorkspaceFileGrepPath(path: string | undefined): path is string {
  if (!path) return false
  return /^(recently-deleted\/)?files(\/|$)/.test(path.replace(/^\/+/, ''))
}

/** True when a grep `path` targets the chat-scoped uploads namespace. */
function isChatUploadGrepPath(path: string | undefined): path is string {
  if (!path) return false
  return /^uploads(\/|$)/.test(path.replace(/^\/+/, ''))
}

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
    content.startsWith('[Image too large:') ||
    content.startsWith('[Compiled artifact too large:')
  )
}

function hasModelAttachment(result: unknown): boolean {
  if (!result || typeof result !== 'object') {
    return false
  }
  const attachment = (result as { attachment?: { type?: string } }).attachment
  return (
    attachment?.type === 'image' || attachment?.type === 'file' || attachment?.type === 'document'
  )
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

  const rawPath = typeof params.path === 'string' ? params.path : undefined

  try {
    const grepOptions = {
      maxResults: (params.maxResults as number) ?? 50,
      outputMode: outputMode as 'content' | 'files_with_matches' | 'count',
      ignoreCase: (params.ignoreCase as boolean) ?? false,
      lineNumbers: (params.lineNumbers as boolean) ?? true,
      context: (params.context as number) ?? 0,
    }

    // Routing mirrors read/glob:
    //  - uploads/<file>  -> grep one chat upload's content (chat-scoped)
    //  - files/<file>    -> grep one workspace file's content (one file only)
    //  - everything else -> grep the in-memory VFS map (workflow JSON, metadata)
    // Chat uploads are opt-in like recently-deleted/: they are never in the VFS
    // map, so an unscoped grep can't touch them — only an explicit uploads/<file>
    // path does, and only one upload at a time.
    let result: GrepMatch[] | string[] | GrepCountEntry[]
    if (isChatUploadGrepPath(rawPath)) {
      if (!context.chatId) {
        return { success: false, error: 'No chat context available for uploads/' }
      }
      // The upload is the first segment after uploads/; any trailing segment
      // (e.g. a /content suffix) is ignored, mirroring the uploads read path.
      const filename = rawPath
        .replace(/^\/+/, '')
        .replace(/^uploads\/?/, '')
        .split('/')[0]
      if (!filename) {
        return {
          success: false,
          error:
            'Grep over chat uploads must target a single upload (e.g. path: "uploads/report.json"). Use glob("uploads/*") to list uploads.',
        }
      }
      result = await grepChatUpload(filename, context.chatId, pattern, grepOptions)
    } else {
      const vfs = await getGatedVFS(workspaceId, context.userId)
      result = isWorkspaceFileGrepPath(rawPath)
        ? await vfs.grepFile(rawPath, pattern, grepOptions)
        : await vfs.grep(pattern, rawPath, grepOptions)
    }
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
    logger.debug('vfs_grep result', { pattern, path: rawPath, outputMode, matchCount })
    return { success: true, output }
  } catch (err) {
    // Expected single-file scoping / no-text / too-large conditions: surface the
    // message verbatim instead of logging an internal failure.
    if (err instanceof WorkspaceFileGrepError) {
      logger.debug('vfs_grep workspace file rejected', {
        pattern,
        path: rawPath,
        error: err.message,
      })
      return { success: false, error: err.message }
    }
    logger.error('vfs_grep failed', {
      pattern,
      path: rawPath,
      error: toError(err).message,
    })
    return { success: false, error: getErrorMessage(err, 'vfs_grep failed') }
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
    const vfs = await getGatedVFS(workspaceId, context.userId)
    let files = vfs.glob(pattern)

    if (context.chatId && (pattern === 'uploads/*' || pattern.startsWith('uploads/'))) {
      const uploads = await listChatUploads(context.chatId)
      // Encode per segment so uploads/ paths match the files/ convention; the
      // upload resolver accepts both the encoded path and the raw display name.
      const uploadPaths = uploads.map((f) => `uploads/${encodeUploadSegment(f.name)}`)
      files = [...files, ...uploadPaths]
    }

    logger.debug('vfs_glob result', { pattern, fileCount: files.length })
    return { success: true, output: { files } }
  } catch (err) {
    logger.error('vfs_glob failed', {
      pattern,
      error: toError(err).message,
    })
    return { success: false, error: getErrorMessage(err, 'vfs_glob failed') }
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

    // Handle chat-scoped uploads via the uploads/ virtual prefix.
    // Uploads are flat and have no metadata/content split like files/ — the upload
    // IS the first path segment after uploads/. Any trailing segment (e.g. a
    // /content suffix added out of habit) is ignored so the read resolves either way.
    if (path.startsWith('uploads/')) {
      if (!context.chatId) {
        return { success: false, error: 'No chat context available for uploads/' }
      }
      const filename = path.slice('uploads/'.length).split('/')[0]
      const uploadResult = await readChatUpload(filename, context.chatId)
      if (uploadResult) {
        const isAttachment = hasModelAttachment(uploadResult)
        if (
          !isAttachment &&
          (isOversizedReadPlaceholder(uploadResult.content) ||
            serializedResultSize(uploadResult) > TOOL_RESULT_MAX_INLINE_CHARS)
        ) {
          logger.warn('Upload read result too large', {
            path,
            hasAttachment: isAttachment,
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
          hasAttachment: isAttachment,
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

    const vfs = await getGatedVFS(workspaceId, context.userId)

    // Plain canonical file leaves are metadata resources. Dynamic file content
    // and inspection paths use explicit suffixes like /content, /style,
    // /compiled-check, or /compiled.
    const shouldReadDynamicFileContent =
      /^recently-deleted\/files\/.+\/content$/.test(path) ||
      /^files\/.+\/(?:content|style|compiled-check|compiled|render|extract)$/.test(path)
    const fileContent = shouldReadDynamicFileContent ? await vfs.readFileContent(path) : null
    if (fileContent) {
      const isAttachment = hasModelAttachment(fileContent)
      if (
        !isAttachment &&
        (isOversizedReadPlaceholder(fileContent.content) ||
          serializedResultSize(fileContent) > TOOL_RESULT_MAX_INLINE_CHARS)
      ) {
        logger.warn('File read result too large', {
          path,
          hasAttachment: isAttachment,
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
        hasAttachment: isAttachment,
        offset,
        limit,
      })
      return {
        success: true,
        output: windowedFileContent,
      }
    }

    const result = await vfs.read(path, offset, limit)
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
      !hasModelAttachment(result) &&
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
    return { success: false, error: getErrorMessage(err, 'vfs_read failed') }
  }
}
