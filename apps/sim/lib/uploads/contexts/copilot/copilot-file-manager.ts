import { createLogger } from '@/lib/logs/console/logger'
import {
  deleteFile,
  downloadFile,
  generatePresignedDownloadUrl,
  generatePresignedUploadUrl,
} from '@/lib/uploads/core/storage-service'
import type { PresignedUrlResponse } from '@/lib/uploads/shared/types'

const logger = createLogger('CopilotFileManager')

const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]

/**
 * Check if a file type is a supported image format for copilot
 */
export function isSupportedFileType(mimeType: string): boolean {
  return SUPPORTED_IMAGE_TYPES.includes(mimeType.toLowerCase())
}

/**
 * Check if a content type is an image
 */
export function isImageFileType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('image/')
}

export interface CopilotFileAttachment {
  key: string
  filename: string
  media_type: string
}

export interface GenerateCopilotUploadUrlOptions {
  fileName: string
  contentType: string
  fileSize: number
  userId: string
  expirationSeconds?: number
}

/**
 * Generate a presigned URL for copilot file upload
 *
 * Only image files are allowed for copilot uploads.
 * Requires authenticated user session.
 *
 * @param options Upload URL generation options
 * @returns Presigned URL response with upload URL and file key
 * @throws Error if file type is not an image or user is not authenticated
 */
export async function generateCopilotUploadUrl(
  options: GenerateCopilotUploadUrlOptions
): Promise<PresignedUrlResponse> {
  const { fileName, contentType, fileSize, userId, expirationSeconds = 3600 } = options

  if (!userId?.trim()) {
    throw new Error('Authenticated user session is required for copilot uploads')
  }

  if (!isImageFileType(contentType)) {
    throw new Error('Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed for copilot uploads')
  }

  const presignedUrlResponse = await generatePresignedUploadUrl({
    fileName,
    contentType,
    fileSize,
    context: 'copilot',
    userId,
    expirationSeconds,
  })

  logger.info(`Generated copilot upload URL for: ${fileName}`, {
    key: presignedUrlResponse.key,
    userId,
  })

  return presignedUrlResponse
}

/**
 * Download a copilot file from storage
 *
 * Uses the unified storage service with explicit copilot context.
 * Handles S3, Azure Blob, and local storage automatically.
 *
 * @param key File storage key
 * @returns File buffer
 * @throws Error if file not found or download fails
 */
export async function downloadCopilotFile(key: string): Promise<Buffer> {
  try {
    const fileBuffer = await downloadFile({
      key,
      context: 'copilot',
    })

    logger.info(`Successfully downloaded copilot file: ${key}`, {
      size: fileBuffer.length,
    })

    return fileBuffer
  } catch (error) {
    logger.error(`Failed to download copilot file: ${key}`, error)
    throw error
  }
}

/**
 * Process copilot file attachments for chat messages
 *
 * Downloads files from storage and validates they are supported types.
 * Skips unsupported files with a warning.
 *
 * @param attachments Array of file attachments
 * @param requestId Request identifier for logging
 * @returns Array of buffers for successfully downloaded files
 */
export async function processCopilotAttachments(
  attachments: CopilotFileAttachment[],
  requestId: string
): Promise<Array<{ buffer: Buffer; attachment: CopilotFileAttachment }>> {
  const results: Array<{ buffer: Buffer; attachment: CopilotFileAttachment }> = []

  for (const attachment of attachments) {
    try {
      if (!isSupportedFileType(attachment.media_type)) {
        logger.warn(`[${requestId}] Unsupported file type: ${attachment.media_type}`)
        continue
      }

      const buffer = await downloadCopilotFile(attachment.key)

      results.push({ buffer, attachment })
    } catch (error) {
      logger.error(`[${requestId}] Failed to process file ${attachment.filename}:`, error)
    }
  }

  logger.info(`Successfully processed ${results.length}/${attachments.length} attachments`, {
    requestId,
  })

  return results
}

/**
 * Generate a presigned download URL for a copilot file
 *
 * @param key File storage key
 * @param expirationSeconds Time in seconds until URL expires (default: 1 hour)
 * @returns Presigned download URL
 */
export async function generateCopilotDownloadUrl(
  key: string,
  expirationSeconds = 3600
): Promise<string> {
  const downloadUrl = await generatePresignedDownloadUrl(key, 'copilot', expirationSeconds)

  logger.info(`Generated copilot download URL for: ${key}`)

  return downloadUrl
}

/**
 * Delete a copilot file from storage
 *
 * @param key File storage key
 */
export async function deleteCopilotFile(key: string): Promise<void> {
  await deleteFile({
    key,
    context: 'copilot',
  })

  logger.info(`Successfully deleted copilot file: ${key}`)
}
