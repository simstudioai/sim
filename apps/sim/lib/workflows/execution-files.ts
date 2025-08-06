/**
 * Execution file management system for binary data transfer between blocks
 * This handles file storage, retrieval, and cleanup for workflow executions
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { UserFile } from '@/executor/types'

const logger = createLogger('ExecutionFiles')

/**
 * Execution context for file operations
 */
export interface ExecutionContext {
  workspaceId: string
  workflowId: string
  executionId: string
}

/**
 * File metadata stored in execution logs
 */
export interface ExecutionFileMetadata {
  id: string
  fileKey: string
  fileName: string
  fileSize: number
  fileType: string
  storageProvider: 's3' | 'blob' | 'local'
  bucketName?: string
  directUrl?: string
  uploadedAt: string
  expiresAt: string
}

/**
 * Generate execution-scoped storage key
 * Format: workspace_id/workflow_id/execution_id/filename
 */
export function generateExecutionFileKey(context: ExecutionContext, fileName: string): string {
  const { workspaceId, workflowId, executionId } = context
  const safeFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
  return `${workspaceId}/${workflowId}/${executionId}/${safeFileName}`
}

/**
 * Generate execution prefix for cleanup operations
 * Format: workspace_id/workflow_id/execution_id/
 */
export function generateExecutionPrefix(context: ExecutionContext): string {
  const { workspaceId, workflowId, executionId } = context
  return `${workspaceId}/${workflowId}/${executionId}/`
}

/**
 * Convert ExecutionFileMetadata to UserFile for block outputs
 */
export function metadataToUserFile(metadata: ExecutionFileMetadata): UserFile {
  return {
    id: metadata.id,
    name: metadata.fileName,
    size: metadata.fileSize,
    type: metadata.fileType,
    url: metadata.directUrl || `/api/files/serve/${metadata.fileKey}`, // Use 5-minute presigned URL, fallback to serve path
    key: metadata.fileKey,
    uploadedAt: metadata.uploadedAt,
    expiresAt: metadata.expiresAt,
    storageProvider: metadata.storageProvider,
    bucketName: metadata.bucketName,
  }
}

/**
 * Convert UserFile to ExecutionFileMetadata for storage
 */
export function userFileToMetadata(
  userFile: UserFile,
  storageProvider: 's3' | 'blob' | 'local' = 's3',
  bucketName?: string
): ExecutionFileMetadata {
  return {
    id: userFile.id,
    fileKey: userFile.key,
    fileName: userFile.name,
    fileSize: userFile.size,
    fileType: userFile.type,
    storageProvider,
    bucketName,
    directUrl: userFile.url, // Store the 5-minute presigned URL
    uploadedAt: userFile.uploadedAt,
    expiresAt: userFile.expiresAt,
  }
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
 * Get file expiration date (30 days from now)
 */
export function getFileExpirationDate(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
}
