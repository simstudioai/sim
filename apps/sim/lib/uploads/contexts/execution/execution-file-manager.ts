/**
 * Specialized storage client for workflow execution files
 * Uses dedicated S3 bucket: sim-execution-files
 * Directory structure: workspace_id/workflow_id/execution_id/filename
 */

import { createLogger } from '@/lib/logs/console/logger'
import {
  deleteFile,
  downloadFile,
  generatePresignedDownloadUrl,
  uploadFile,
} from '@/lib/uploads/core/storage-service'
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
  isAsync?: boolean
): Promise<UserFile> {
  logger.info(`Uploading execution file: ${fileName} for execution ${context.executionId}`)
  logger.debug(`File upload context:`, {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    executionId: context.executionId,
    fileName,
    bufferSize: fileBuffer.length,
  })

  // Generate execution-scoped storage key
  const storageKey = generateExecutionFileKey(context, fileName)
  const fileId = generateFileId()

  logger.info(`Generated storage key: "${storageKey}" for file: ${fileName}`)

  // Use 10-minute expiration for async executions, 5 minutes for sync
  const urlExpirationSeconds = isAsync ? 10 * 60 : 5 * 60

  try {
    // Upload using unified storage service with execution context
    const fileInfo = await uploadFile({
      file: fileBuffer,
      fileName: storageKey,
      contentType,
      context: 'execution',
      preserveKey: true, // Don't add timestamp prefix
      customKey: storageKey, // Use exact execution-scoped key
    })

    logger.info(`Upload returned key: "${fileInfo.key}" for file: ${fileName}`)
    logger.info(`Original storage key was: "${storageKey}"`)
    logger.info(`Keys match: ${fileInfo.key === storageKey}`)

    // Generate presigned URL for execution (5 or 10 minutes)
    let directUrl: string | undefined
    try {
      logger.info(
        `Generating presigned URL with key: "${fileInfo.key}" (expiration: ${urlExpirationSeconds / 60} minutes)`
      )
      directUrl = await generatePresignedDownloadUrl(
        fileInfo.key,
        'execution',
        urlExpirationSeconds
      )
      logger.info(`Generated presigned URL: ${directUrl}`)
    } catch (error) {
      logger.warn(`Failed to generate presigned URL for ${fileName}:`, error)
    }

    const userFile: UserFile = {
      id: fileId,
      name: fileName,
      size: fileBuffer.length,
      type: contentType,
      url: directUrl || `/api/files/serve/${fileInfo.key}`, // Use presigned URL (5 or 10 min), fallback to serve path
      key: fileInfo.key, // Use the actual uploaded key from S3/Blob
      uploadedAt: new Date().toISOString(),
      expiresAt: getFileExpirationDate(),
      context: 'execution',
    }

    logger.info(`Successfully uploaded execution file: ${fileName} (${fileBuffer.length} bytes)`)
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
