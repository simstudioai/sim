/**
 * Chat File Manager
 *
 * Manages file uploads for chat interactions. Chat files use the 'execution' context
 * for temporary storage with 5-10 minute expiry. This is intentional for:
 * - Privacy: Files are automatically cleaned up after processing
 * - Cost control: No long-term storage costs for chat attachments
 * - Security: Temporary files reduce attack surface
 *
 * This is a thin wrapper around the execution file manager that provides
 * chat-specific interfaces and explicitly sets the execution context.
 */

import { processExecutionFiles } from '@/lib/execution/files'
import { createLogger } from '@/lib/logs/console/logger'
import type { UserFile } from '@/executor/types'

const logger = createLogger('ChatFileManager')

export interface ChatFile {
  dataUrl?: string // Base64-encoded file data (data:mime;base64,...)
  url?: string // Direct URL to existing file
  name: string // Original filename
  type: string // MIME type
}

export interface ChatExecutionContext {
  workspaceId: string
  workflowId: string
  executionId: string
}

/**
 * Process and upload chat files to temporary execution storage
 *
 * Handles two input formats:
 * 1. Base64 dataUrl - File content encoded as data URL (uploaded from client)
 * 2. Direct URL - Pass-through URL to existing file (already uploaded)
 *
 * Files are stored in the execution context with 5-10 minute expiry.
 * Delegates to shared execution file processing logic.
 *
 * @param files Array of chat file attachments
 * @param executionContext Execution context for temporary storage
 * @param requestId Unique request identifier for logging/tracing
 * @returns Array of UserFile objects with upload results
 */
export async function processChatFiles(
  files: ChatFile[],
  executionContext: ChatExecutionContext,
  requestId: string
): Promise<UserFile[]> {
  logger.info(
    `Processing ${files.length} chat files for execution ${executionContext.executionId}`,
    {
      requestId,
      executionContext,
    }
  )

  // Transform chat file format to execution file format
  const transformedFiles = files.map((file) => ({
    type: file.dataUrl ? ('file' as const) : ('url' as const),
    data: file.dataUrl || file.url || '',
    name: file.name,
    mime: file.type,
  }))

  // Delegate to execution file processor
  // This uses storage-service internally with 'execution' context
  const userFiles = await processExecutionFiles(transformedFiles, executionContext, requestId)

  logger.info(`Successfully processed ${userFiles.length} chat files`, {
    requestId,
    executionId: executionContext.executionId,
  })

  return userFiles
}

/**
 * Upload a single chat file to temporary execution storage
 *
 * This is a convenience function for uploading individual files.
 * For batch uploads, use processChatFiles() for better performance.
 *
 * @param file Chat file to upload
 * @param executionContext Execution context for temporary storage
 * @param requestId Unique request identifier
 * @returns UserFile object with upload result
 */
export async function uploadChatFile(
  file: ChatFile,
  executionContext: ChatExecutionContext,
  requestId: string
): Promise<UserFile> {
  const [userFile] = await processChatFiles([file], executionContext, requestId)
  return userFile
}

/**
 * Re-export UserFile type for convenience
 */
export type { UserFile } from '@/executor/types'
