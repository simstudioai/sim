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
 * Generate execution-scoped storage key with explicit prefix
 * Format: execution/workspace_id/workflow_id/execution_id/filename
 */
export function generateExecutionFileKey(context: ExecutionContext, fileName: string): string {
  const { workspaceId, workflowId, executionId } = context
  const safeFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
  return `execution/${workspaceId}/${workflowId}/${executionId}/${safeFileName}`
}

/**
 * Generate unique file ID for execution files
 */
export function generateFileId(): string {
  return `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * UUID pattern for validating execution context IDs
 */
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

/**
 * Check if a string matches UUID pattern
 */
export function isUuid(str: string): boolean {
  return UUID_PATTERN.test(str)
}

/**
 * Check if a key matches execution file pattern
 * Execution files have keys in format: execution/workspaceId/workflowId/executionId/filename
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
 * Execution files have keys in format: execution/workspaceId/workflowId/executionId/filename
 */
export function isExecutionFile(file: UserFile): boolean {
  if (!file.key) {
    return false
  }

  return matchesExecutionFilePattern(file.key)
}
