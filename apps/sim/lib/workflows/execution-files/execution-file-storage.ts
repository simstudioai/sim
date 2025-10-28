/**
 * Specialized storage client for workflow execution files
 * Uses dedicated S3 bucket: sim-execution-files
 * Directory structure: workspace_id/workflow_id/execution_id/filename
 */

import { createLogger } from '@/lib/logs/console/logger'
import {
  deleteFromBlob,
  downloadFromBlob,
  getPresignedUrlWithConfig as getBlobPresignedUrlWithConfig,
  uploadToBlob,
} from '@/lib/uploads/blob/blob-client'
import {
  deleteFromS3,
  downloadFromS3,
  getPresignedUrlWithConfig,
  uploadToS3,
} from '@/lib/uploads/s3/s3-client'
import {
  BLOB_EXECUTION_FILES_CONFIG,
  S3_EXECUTION_FILES_CONFIG,
  USE_BLOB_STORAGE,
  USE_S3_STORAGE,
} from '@/lib/uploads/setup'
import { deleteFile, downloadFile } from '@/lib/uploads/storage-client'
import type { UserFile } from '@/executor/types'
import type { ExecutionContext } from './execution-files'
import { generateExecutionFileKey, generateFileId, getFileExpirationDate } from './execution-files'

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
    let fileInfo: any
    let directUrl: string | undefined

    if (USE_S3_STORAGE) {
      // Upload to S3 execution files bucket with exact key (no timestamp prefix)
      logger.debug(
        `Uploading to S3 with key: ${storageKey}, bucket: ${S3_EXECUTION_FILES_CONFIG.bucket}`
      )
      fileInfo = await uploadToS3(
        fileBuffer,
        storageKey, // Use storageKey as fileName
        contentType,
        {
          bucket: S3_EXECUTION_FILES_CONFIG.bucket,
          region: S3_EXECUTION_FILES_CONFIG.region,
        },
        undefined, // size (will use buffer length)
        true // skipTimestampPrefix = true
      )

      logger.info(`S3 upload returned key: "${fileInfo.key}" for file: ${fileName}`)
      logger.info(`Original storage key was: "${storageKey}"`)
      logger.info(`Keys match: ${fileInfo.key === storageKey}`)

      // Generate presigned URL for execution (5 or 10 minutes)
      try {
        logger.info(
          `Generating presigned URL with key: "${fileInfo.key}" (expiration: ${urlExpirationSeconds / 60} minutes)`
        )
        directUrl = await getPresignedUrlWithConfig(
          fileInfo.key, // Use the actual uploaded key
          {
            bucket: S3_EXECUTION_FILES_CONFIG.bucket,
            region: S3_EXECUTION_FILES_CONFIG.region,
          },
          urlExpirationSeconds
        )
        logger.info(`Generated presigned URL: ${directUrl}`)
      } catch (error) {
        logger.warn(`Failed to generate S3 presigned URL for ${fileName}:`, error)
      }
    } else if (USE_BLOB_STORAGE) {
      // Upload to Azure Blob execution files container
      fileInfo = await uploadToBlob(fileBuffer, storageKey, contentType, {
        accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
        accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
        connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
        containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
      })

      // Generate presigned URL for execution (5 or 10 minutes)
      try {
        directUrl = await getBlobPresignedUrlWithConfig(
          fileInfo.key, // Use the actual uploaded key
          {
            accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
            accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
            connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
            containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
          },
          urlExpirationSeconds
        )
      } catch (error) {
        logger.warn(`Failed to generate Blob presigned URL for ${fileName}:`, error)
      }
    } else {
      // Fallback to local file storage - consistent with storage-client
      logger.info('Using local file storage for execution file')
      const { writeFile } = await import('fs/promises')
      const { join } = await import('path')
      const { v4: uuidv4 } = await import('uuid')
      const { UPLOAD_DIR_SERVER } = await import('@/lib/uploads/setup.server')

      // Convert forward slashes in storageKey to underscores and add UUID prefix
      const safeKey = storageKey.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.\./g, '')
      const uniqueKey = `${uuidv4()}-${safeKey}`
      const filePath = join(UPLOAD_DIR_SERVER, uniqueKey)

      try {
        await writeFile(filePath, fileBuffer)
      } catch (error) {
        logger.error(`Failed to write file to local storage: ${fileName}`, error)
        throw new Error(
          `Failed to write file to local storage: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }

      fileInfo = {
        path: `/api/files/serve/${uniqueKey}`,
        key: uniqueKey,
        name: fileName,
        size: fileBuffer.length,
        type: contentType,
      }

      // For local storage, use the serve path as the URL
      directUrl = fileInfo.path
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
    let fileBuffer: Buffer

    if (USE_S3_STORAGE) {
      fileBuffer = await downloadFromS3(userFile.key, {
        bucket: S3_EXECUTION_FILES_CONFIG.bucket,
        region: S3_EXECUTION_FILES_CONFIG.region,
      })
    } else if (USE_BLOB_STORAGE) {
      fileBuffer = await downloadFromBlob(userFile.key, {
        accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
        accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
        connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
        containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
      })
    } else {
      // Use storage-client for local file storage
      fileBuffer = await downloadFile(userFile.key)
    }

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
  logger.info(`S3 bucket: ${S3_EXECUTION_FILES_CONFIG.bucket}`)

  try {
    let downloadUrl: string

    if (USE_S3_STORAGE) {
      downloadUrl = await getPresignedUrlWithConfig(
        userFile.key,
        {
          bucket: S3_EXECUTION_FILES_CONFIG.bucket,
          region: S3_EXECUTION_FILES_CONFIG.region,
        },
        5 * 60 // 5 minutes
      )
    } else if (USE_BLOB_STORAGE) {
      downloadUrl = await getBlobPresignedUrlWithConfig(
        userFile.key,
        {
          accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
          accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
          connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
          containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
        },
        5 * 60 // 5 minutes
      )
    } else {
      // Fallback to local file storage - return serve path
      logger.info('Generating local serve path for execution file')
      downloadUrl = `/api/files/serve/${encodeURIComponent(userFile.key)}`
    }

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
    if (USE_S3_STORAGE) {
      await deleteFromS3(userFile.key, {
        bucket: S3_EXECUTION_FILES_CONFIG.bucket,
        region: S3_EXECUTION_FILES_CONFIG.region,
      })
    } else if (USE_BLOB_STORAGE) {
      await deleteFromBlob(userFile.key, {
        accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
        accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
        connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
        containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
      })
    } else {
      // Use storage-client for local file storage
      await deleteFile(userFile.key)
    }

    logger.info(`Successfully deleted execution file: ${userFile.name}`)
  } catch (error) {
    logger.error(`Failed to delete execution file ${userFile.name}:`, error)
    throw new Error(
      `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
