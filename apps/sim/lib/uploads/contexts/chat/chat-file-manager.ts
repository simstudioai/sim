import { processExecutionFiles } from '@/lib/execution/files'
import { createLogger } from '@/lib/logs/console/logger'
import type { UserFile } from '@/executor/types'

const logger = createLogger('ChatFileManager')

export interface ChatFile {
  data?: string // Legacy field - base64-encoded file data (data:mime;base64,...) or raw base64
  dataUrl?: string // Preferred field - base64-encoded file data (data:mime;base64,...)
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
 *
 * @param files Array of chat file attachments
 * @param executionContext Execution context for temporary storage
 * @param requestId Unique request identifier for logging/tracing
 * @param userId User ID for file metadata (optional)
 * @returns Array of UserFile objects with upload results
 */
export async function processChatFiles(
  files: ChatFile[],
  executionContext: ChatExecutionContext,
  requestId: string,
  userId?: string
): Promise<UserFile[]> {
  logger.info(
    `Processing ${files.length} chat files for execution ${executionContext.executionId}`,
    {
      requestId,
      executionContext,
    }
  )

  const transformedFiles = files.map((file) => {
    const inlineData = file.dataUrl || file.data

    return {
      type: inlineData ? ('file' as const) : ('url' as const),
      data: inlineData || file.url || '',
      name: file.name,
      mime: file.type,
    }
  })

  const userFiles = await processExecutionFiles(
    transformedFiles,
    executionContext,
    requestId,
    userId
  )

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
  requestId: string,
  userId?: string
): Promise<UserFile> {
  const [userFile] = await processChatFiles([file], executionContext, requestId, userId)
  return userFile
}
