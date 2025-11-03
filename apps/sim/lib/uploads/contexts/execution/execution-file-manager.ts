import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import type { UserFile } from '@/executor/types'
import type { ExecutionContext } from './execution-file-helpers'
import {
  generateExecutionFileKey,
  generateFileId,
  getFileExpirationDate,
} from './execution-file-helpers'

const logger = createLogger('ExecutionFileStorage')

/**
 * Upload a file to execution-scoped storage
 */
export async function uploadExecutionFile(
  context: ExecutionContext,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
  userId?: string
): Promise<UserFile> {
  logger.info(`Uploading execution file: ${fileName} for execution ${context.executionId}`)
  logger.debug(`File upload context:`, {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    executionId: context.executionId,
    userId: userId || 'not provided',
    fileName,
    bufferSize: fileBuffer.length,
  })

  const storageKey = generateExecutionFileKey(context, fileName)
  const fileId = generateFileId()

  logger.info(`Generated storage key: "${storageKey}" for file: ${fileName}`)

  const metadata: Record<string, string> = {
    originalName: fileName,
    uploadedAt: new Date().toISOString(),
    purpose: 'execution',
    workspaceId: context.workspaceId,
  }

  if (userId) {
    metadata.userId = userId
  }

  try {
    const { uploadFile } = await import('@/lib/uploads/core/storage-service')
    const fileInfo = await uploadFile({
      file: fileBuffer,
      fileName: storageKey,
      contentType,
      context: 'execution',
      preserveKey: true, // Don't add timestamp prefix
      customKey: storageKey, // Use exact execution-scoped key
      metadata, // Pass metadata for cloud storage and database tracking
    })

    // Generate full URL for file access (useful for passing to external services)
    const baseUrl = getBaseUrl()
    const fullUrl = `${baseUrl}/api/files/serve/${fileInfo.key}`

    const userFile: UserFile = {
      id: fileId,
      name: fileName,
      size: fileBuffer.length,
      type: contentType,
      url: fullUrl, // Full URL for external access and downstream workflow usage
      key: fileInfo.key,
      uploadedAt: new Date().toISOString(),
      expiresAt: getFileExpirationDate(),
      context: 'execution', // Preserve context in file object
    }

    logger.info(`Successfully uploaded execution file: ${fileName} (${fileBuffer.length} bytes)`, {
      url: fullUrl,
      key: fileInfo.key,
    })
    return userFile
  } catch (error) {
    logger.error(`Failed to upload execution file ${fileName}:`, error)
    throw new Error(
      `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Download a file from execution-scoped storage
 */
export async function downloadExecutionFile(userFile: UserFile): Promise<Buffer> {
  logger.info(`Downloading execution file: ${userFile.name}`)

  try {
    const { downloadFile } = await import('@/lib/uploads/core/storage-service')
    const fileBuffer = await downloadFile({
      key: userFile.key,
      context: 'execution',
    })

    logger.info(
      `Successfully downloaded execution file: ${userFile.name} (${fileBuffer.length} bytes)`
    )
    return fileBuffer
  } catch (error) {
    logger.error(`Failed to download execution file ${userFile.name}:`, error)
    throw new Error(
      `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Generate a short-lived presigned URL for file download (5 minutes)
 */
export async function generateExecutionFileDownloadUrl(userFile: UserFile): Promise<string> {
  logger.info(`Generating download URL for execution file: ${userFile.name}`)
  logger.info(`File key: "${userFile.key}"`)

  try {
    const { generatePresignedDownloadUrl } = await import('@/lib/uploads/core/storage-service')
    const downloadUrl = await generatePresignedDownloadUrl(
      userFile.key,
      'execution',
      5 * 60 // 5 minutes
    )

    logger.info(`Generated download URL for execution file: ${userFile.name}`)
    return downloadUrl
  } catch (error) {
    logger.error(`Failed to generate download URL for ${userFile.name}:`, error)
    throw new Error(
      `Failed to generate download URL: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Delete a file from execution-scoped storage
 */
export async function deleteExecutionFile(userFile: UserFile): Promise<void> {
  logger.info(`Deleting execution file: ${userFile.name}`)

  try {
    const { deleteFile } = await import('@/lib/uploads/core/storage-service')
    await deleteFile({
      key: userFile.key,
      context: 'execution',
    })

    logger.info(`Successfully deleted execution file: ${userFile.name}`)
  } catch (error) {
    logger.error(`Failed to delete execution file ${userFile.name}:`, error)
    throw new Error(
      `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
