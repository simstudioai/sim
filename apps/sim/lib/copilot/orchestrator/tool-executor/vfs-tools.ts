import { createLogger } from '@sim/logger'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/orchestrator/types'
import { getOrMaterializeVFS } from '@/lib/copilot/vfs'

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
    const result = vfs.grep(
      pattern,
      params.path as string | undefined,
      {
        maxResults: (params.maxResults as number) ?? 50,
        outputMode: (params.output_mode as 'content' | 'files_with_matches' | 'count') ?? 'content',
        ignoreCase: (params.ignoreCase as boolean) ?? false,
        lineNumbers: (params.lineNumbers as boolean) ?? true,
        context: (params.context as number) ?? 0,
      }
    )
    const outputMode = (params.output_mode as string) ?? 'content'
    const key = outputMode === 'files_with_matches' ? 'files' : outputMode === 'count' ? 'counts' : 'matches'
    return { success: true, output: { [key]: result } }
  } catch (err) {
    logger.error('vfs_grep failed', {
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
    return { success: true, output: { files } }
  } catch (err) {
    logger.error('vfs_glob failed', {
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
      return { success: false, error: `File not found: ${path}` }
    }
    return { success: true, output: result }
  } catch (err) {
    logger.error('vfs_read failed', {
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
    return { success: true, output: { entries } }
  } catch (err) {
    logger.error('vfs_list failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return { success: false, error: err instanceof Error ? err.message : 'vfs_list failed' }
  }
}
