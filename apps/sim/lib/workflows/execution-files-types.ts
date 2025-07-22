/**
 * Client-safe types for execution file metadata
 * This file contains only TypeScript interfaces and can be safely imported by client components
 */

/**
 * Execution context for file operations
 */
export interface ExecutionContext {
  workspaceId: string
  workflowId: string
  executionId: string
}

/**
 * File reference with metadata
 */
export interface WorkflowFileReference {
  path: string // API path to serve the file (for internal use)
  directUrl?: string // Direct cloud storage URL (for external services)
  key: string // Storage key/path
  name: string // Original filename
  size: number // File size in bytes
  type: string // MIME type
  executionContext: ExecutionContext
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

// ExecutionLogMetadata removed - no longer needed after enhanced logger refactor
