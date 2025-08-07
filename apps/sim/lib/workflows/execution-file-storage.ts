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
  contentType: string
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

      // Generate presigned URL for execution (5 minutes)
      try {
        logger.info(`Generating presigned URL with key: "${fileInfo.key}"`)
        directUrl = await getPresignedUrlWithConfig(
          fileInfo.key, // Use the actual uploaded key
          {
            bucket: S3_EXECUTION_FILES_CONFIG.bucket,
            region: S3_EXECUTION_FILES_CONFIG.region,
          },
          5 * 60 // 5 minutes
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

      // Generate presigned URL for execution (5 minutes)
      try {
        directUrl = await getBlobPresignedUrlWithConfig(
          fileInfo.key, // Use the actual uploaded key
          {
            accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
            accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
            connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
            containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
          },
          5 * 60 // 5 minutes
        )
      } catch (error) {
        logger.warn(`Failed to generate Blob presigned URL for ${fileName}:`, error)
      }
    } else {
      throw new Error('No cloud storage configured for execution files')
    }

    const userFile: UserFile = {
      id: fileId,
      name: fileName,
      size: fileBuffer.length,
      type: contentType,
      url: directUrl || `/api/files/serve/${fileInfo.key}`, // Use 5-minute presigned URL, fallback to serve path
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
      throw new Error('No cloud storage configured for execution files')
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
      throw new Error('No cloud storage configured for execution files')
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
      throw new Error('No cloud storage configured for execution files')
    }

    logger.info(`Successfully deleted execution file: ${userFile.name}`)
  } catch (error) {
    logger.error(`Failed to delete execution file ${userFile.name}:`, error)
    throw new Error(
      `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
