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
 * File metadata stored in execution logs - now just uses UserFile directly
 */
export type ExecutionFileMetadata = UserFile

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
 * Generate execution prefix for cleanup operations
 * Format: execution/workspace_id/workflow_id/execution_id/
 */
export function generateExecutionPrefix(context: ExecutionContext): string {
  const { workspaceId, workflowId, executionId } = context
  return `execution/${workspaceId}/${workflowId}/${executionId}/`
}

/**
 * Generate unique file ID for execution files
 */
export function generateFileId(): string {
  return `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Check if a user file is expired
 */
export function isFileExpired(userFile: UserFile): boolean {
  return new Date(userFile.expiresAt) < new Date()
}

/**
 * Get file expiration date for execution files (5 minutes from now)
 */
export function getFileExpirationDate(): string {
  return new Date(Date.now() + 5 * 60 * 1000).toISOString()
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
 * Parse execution file key to extract context
 * Format: execution/workspaceId/workflowId/executionId/filename
 * @returns ExecutionContext if key matches pattern, null otherwise
 */
export function parseExecutionFileKey(key: string): ExecutionContext | null {
  if (!key || key.startsWith('/api/') || key.startsWith('http')) {
    return null
  }

  const parts = key.split('/')

  if (parts[0] === 'execution' && parts.length >= 5) {
    const [, workspaceId, workflowId, executionId] = parts
    if (isUuid(workspaceId) && isUuid(workflowId) && isUuid(executionId)) {
      return { workspaceId, workflowId, executionId }
    }
  }

  return null
}

/**
 * Check if a key matches execution file pattern
 * Execution files have keys in format: execution/workspaceId/workflowId/executionId/filename
 */
export function matchesExecutionFilePattern(key: string): boolean {
  return parseExecutionFileKey(key) !== null
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
