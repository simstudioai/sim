import { createLogger } from '@sim/logger'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/orchestrator/types'
import type { MothershipResource } from '@/lib/copilot/resource-types'
import { VFS_DIR_TO_RESOURCE } from '@/lib/copilot/resource-types'
import type { WorkspaceVFS } from '@/lib/copilot/vfs'
import { getOrMaterializeVFS } from '@/lib/copilot/vfs'

const logger = createLogger('VfsTools')

/**
 * Resolves a VFS resource path to its resource descriptor by reading the
 * sibling meta.json (already in memory) for the resource ID and name.
 */
function resolveVfsResource(vfs: WorkspaceVFS, path: string): MothershipResource | null {
  const segments = path.split('/')
  const resourceType = VFS_DIR_TO_RESOURCE[segments[0]]
  if (!resourceType || !segments[1]) return null

  const metaPath = `${segments[0]}/${segments[1]}/meta.json`
  const meta = vfs.read(metaPath)
  if (!meta) return null

  try {
    const parsed = JSON.parse(meta.content)
    const id = parsed?.id as string | undefined
    if (!id) return null
    return { type: resourceType, id, title: (parsed.name as string) || segments[1] }
  } catch {
    return null
  }
}

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
    const files = vfs.glob(pattern)
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
        // Appends metadata of resource to tool response
        const resource = resolveVfsResource(vfs, path)
        return {
          success: true,
          output: fileContent,
          ...(resource && { resources: [resource] }),
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
    // Appends metadata of resource to tool response
    const resource = resolveVfsResource(vfs, path)
    return {
      success: true,
      output: result,
      ...(resource && { resources: [resource] }),
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
