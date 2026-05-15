import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { performRestoreResource, type RestorableResourceType } from '@/lib/resources/orchestration'

const VALID_TYPES = new Set(['workflow', 'table', 'file', 'knowledgebase', 'folder', 'file_folder'])

export async function executeRestoreResource(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const type = rawParams.type as string | undefined
  const id = rawParams.id as string | undefined

  if (!type || !VALID_TYPES.has(type)) {
    return { success: false, error: `Invalid type. Must be one of: ${[...VALID_TYPES].join(', ')}` }
  }
  if (!id) {
    return { success: false, error: 'id is required' }
  }
  if (!context.workspaceId) {
    return { success: false, error: 'Workspace context required' }
  }

  return performRestoreResource({
    type: type as RestorableResourceType,
    id,
    userId: context.userId,
    workspaceId: context.workspaceId,
  }) as Promise<ToolCallResult>
}
