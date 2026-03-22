import { createLogger } from '@sim/logger'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/orchestrator/types'
import { getOrMaterializeVFS } from '@/lib/copilot/vfs'
import { listChatUploads, readChatUpload } from './upload-file-reader'

const logger = createLogger('VfsTools')

export async function executeVfsGrep(
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
    const result = vfs.grep(pattern, params.path as string | undefined, {
      maxResults: (params.maxResults as number) ?? 50,
      outputMode: (params.output_mode as 'content' | 'files_with_matches' | 'count') ?? 'content',
      ignoreCase: (params.ignoreCase as boolean) ?? false,
      lineNumbers: (params.lineNumbers as boolean) ?? true,
      context: (params.context as number) ?? 0,
    })
    const outputMode = (params.output_mode as string) ?? 'content'
    const key =
      outputMode === 'files_with_matches' ? 'files' : outputMode === 'count' ? 'counts' : 'matches'
    const matchCount = Array.isArray(result)
      ? result.length
      : typeof result === 'object'
        ? Object.keys(result).length
        : 0
    logger.debug('vfs_grep result', { pattern, path: params.path, outputMode, matchCount })
    return { success: true, output: { [key]: result } }
  } catch (err) {
    logger.error('vfs_grep failed', {
      pattern,
      path: params.path,
      error: err instanceof Error ? err.message : String(err),
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
      error: err instanceof Error ? err.message : String(err),
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
    // Handle chat-scoped uploads via the uploads/ virtual prefix
    if (path.startsWith('uploads/')) {
      if (!context.chatId) {
        return { success: false, error: 'No chat context available for uploads/' }
      }
      const filename = path.slice('uploads/'.length)
      const uploadResult = await readChatUpload(filename, context.chatId)
      if (uploadResult) {
        logger.debug('vfs_read resolved chat upload', { path, totalLines: uploadResult.totalLines })
        return { success: true, output: uploadResult }
      }
      return {
        success: false,
        error: `Upload not found: ${path}. Use glob("uploads/*") to list available uploads.`,
      }
    }

    const vfs = await getOrMaterializeVFS(workspaceId, context.userId)
    const result = vfs.read(
      path,
      params.offset as number | undefined,
      params.limit as number | undefined
    )
    if (!result) {
      const fileContent = await vfs.readFileContent(path)
      if (fileContent) {
        logger.debug('vfs_read resolved workspace file', {
          path,
          totalLines: fileContent.totalLines,
        })
        return {
          success: true,
          output: fileContent,
        }
      }

      const suggestions = vfs.suggestSimilar(path)
      logger.warn('vfs_read file not found', { path, suggestions })
      const hint =
        suggestions.length > 0
          ? ` Did you mean: ${suggestions.join(', ')}?`
          : ' Use glob to discover available paths.'
      return { success: false, error: `File not found: ${path}.${hint}` }
    }
    logger.debug('vfs_read result', { path, totalLines: result.totalLines })
    return {
      success: true,
      output: result,
    }
  } catch (err) {
    logger.error('vfs_read failed', {
      path,
      error: err instanceof Error ? err.message : String(err),
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
      error: err instanceof Error ? err.message : String(err),
    })
    return { success: false, error: err instanceof Error ? err.message : 'vfs_list failed' }
  }
}
