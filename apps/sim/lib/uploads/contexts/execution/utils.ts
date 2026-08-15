import { generateId } from '@sim/utils/id'
import { randomFloat } from '@sim/utils/random'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'
import { isUuid } from '@/executor/constants'
import type { UserFile } from '@/executor/types'

/**
 * Execution context for file operations
 */
export interface ExecutionContext {
  workspaceId: string
  workflowId: string
  executionId: string
}

/**
 * Generate the deterministic storage key for a large-value execution payload.
 * Format: execution/workspace_id/workflow_id/execution_id/large-value-<id>.json
 *
 * Takes the payload id rather than a file name so no user-supplied name can
 * reach a key without a uniquifier — that is what silently overwrote same-named
 * files before {@link generateUniqueExecutionFileKey} existed. Determinism is
 * load-bearing here: the cleanup job matches these keys by LIKE pattern and
 * re-storing the same payload must be idempotent.
 */
export function generateLargeValuePayloadKey(context: ExecutionContext, id: string): string {
  const { workspaceId, workflowId, executionId } = context
  const safeFileName = buildStorageKeySegment('', `large-value-${id}.json`)
  return `execution/${workspaceId}/${workflowId}/${executionId}/${safeFileName}`
}

/**
 * Generate a collision-free execution-scoped storage key.
 * Format: execution/workspace_id/workflow_id/execution_id/unique_id/filename
 *
 * One execution routinely carries several files sharing a display name (two
 * `image.png` screenshots in one Slack message, repeated tool outputs in a
 * loop), which the deterministic key would overwrite. The unique id is its own
 * path segment rather than a filename prefix so the last segment stays the
 * original name — presigned URLs carry no content-disposition, so that segment
 * is what a consumer sees.
 *
 * Large-value payloads, whose ids are already unique, keep using
 * {@link generateLargeValuePayloadKey}.
 */
export function generateUniqueExecutionFileKey(
  context: ExecutionContext,
  fileName: string
): string {
  const { workspaceId, workflowId, executionId } = context
  const safeFileName = buildStorageKeySegment('', fileName)
  return `execution/${workspaceId}/${workflowId}/${executionId}/${generateId()}/${safeFileName}`
}

/**
 * Generate unique file ID for execution files
 */
export function generateFileId(): string {
  return `file_${Date.now()}_${randomFloat().toString(36).substring(2, 9)}`
}

/**
 * Execution keys: execution/workspaceId/workflowId/executionId/[uniqueId/]filename
 */
function matchesExecutionFilePattern(key: string): boolean {
  if (!key || key.startsWith('/api/') || key.startsWith('http')) {
    return false
  }

  const parts = key.split('/')

  if (parts[0] === 'execution' && parts.length >= 5) {
    const [, workspaceId, workflowId, executionId] = parts
    return isUuid(workspaceId) && isUuid(workflowId) && isUuid(executionId)
  }

  return false
}

/**
 * Check if a file is from execution storage based on its key pattern
 */
export function isExecutionFile(file: UserFile): boolean {
  if (!file.key) {
    return false
  }

  return matchesExecutionFilePattern(file.key)
}
