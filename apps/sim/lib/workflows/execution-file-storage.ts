/**
 * Specialized storage client for workflow execution files
 * Uses dedicated S3 bucket: sim-execution-files
 * Directory structure: workspace_id/workflow_id/execution_id/filename
 */

import { createLogger } from '@/lib/logs/console/logger'
import {
  deleteFromBlob,
  downloadFromBlob,
  getPresignedUrl as getBlobPresignedUrl,
  uploadToBlob,
} from '@/lib/uploads/blob/blob-client'
import {
  deleteFromS3,
  downloadFromS3,
  getPresignedUrl as getS3PresignedUrl,
  uploadToS3,
} from '@/lib/uploads/s3/s3-client'
import {
  BLOB_EXECUTION_FILES_CONFIG,
  S3_EXECUTION_FILES_CONFIG,
  USE_BLOB_STORAGE,
  USE_S3_STORAGE,
} from '@/lib/uploads/setup'
import type { FileReference } from '@/executor/types'
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
): Promise<FileReference> {
  logger.info(`Uploading execution file: ${fileName} for execution ${context.executionId}`)

  // Generate execution-scoped storage key
  const storageKey = generateExecutionFileKey(context, fileName)
  const fileId = generateFileId()

  try {
    let fileInfo: any
    let directUrl: string | undefined

    if (USE_S3_STORAGE) {
      // Upload to S3 execution files bucket
      fileInfo = await uploadToS3(fileBuffer, storageKey, contentType, {
        bucket: S3_EXECUTION_FILES_CONFIG.bucket,
        region: S3_EXECUTION_FILES_CONFIG.region,
      })

      // Generate presigned URL for external services (24 hours)
      try {
        directUrl = await getS3PresignedUrl(
          storageKey,
          24 * 60 * 60, // 24 hours
          {
            bucket: S3_EXECUTION_FILES_CONFIG.bucket,
            region: S3_EXECUTION_FILES_CONFIG.region,
          }
        )
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

      // Generate presigned URL for external services (24 hours)
      try {
        directUrl = await getBlobPresignedUrl(
          storageKey,
          24 * 60 * 60, // 24 hours
          {
            accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
            accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
            connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
            containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
          }
        )
      } catch (error) {
        logger.warn(`Failed to generate Blob presigned URL for ${fileName}:`, error)
      }
    } else {
      throw new Error('No cloud storage configured for execution files')
    }

    const fileReference: FileReference = {
      id: fileId,
      name: fileName,
      size: fileBuffer.length,
      type: contentType,
      path: `/api/files/execution/${context.executionId}/${fileId}`,
      directUrl,
      key: storageKey,
      uploadedAt: new Date().toISOString(),
      expiresAt: getFileExpirationDate(),
    }

    logger.info(`Successfully uploaded execution file: ${fileName} (${fileBuffer.length} bytes)`)
    return fileReference
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
export async function downloadExecutionFile(fileReference: FileReference): Promise<Buffer> {
  logger.info(`Downloading execution file: ${fileReference.name}`)

  try {
    let fileBuffer: Buffer

    if (USE_S3_STORAGE) {
      fileBuffer = await downloadFromS3(fileReference.key, {
        bucket: S3_EXECUTION_FILES_CONFIG.bucket,
        region: S3_EXECUTION_FILES_CONFIG.region,
      })
    } else if (USE_BLOB_STORAGE) {
      fileBuffer = await downloadFromBlob(fileReference.key, {
        accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
        accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
        connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
        containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
      })
    } else {
      throw new Error('No cloud storage configured for execution files')
    }

    logger.info(
      `Successfully downloaded execution file: ${fileReference.name} (${fileBuffer.length} bytes)`
    )
    return fileBuffer
  } catch (error) {
    logger.error(`Failed to download execution file ${fileReference.name}:`, error)
    throw new Error(
      `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Generate a short-lived presigned URL for file download (5 minutes)
 */
export async function generateExecutionFileDownloadUrl(
  fileReference: FileReference
): Promise<string> {
  logger.info(`Generating download URL for execution file: ${fileReference.name}`)

  try {
    let downloadUrl: string

    if (USE_S3_STORAGE) {
      downloadUrl = await getS3PresignedUrl(
        fileReference.key,
        5 * 60, // 5 minutes
        {
          bucket: S3_EXECUTION_FILES_CONFIG.bucket,
          region: S3_EXECUTION_FILES_CONFIG.region,
        }
      )
    } else if (USE_BLOB_STORAGE) {
      downloadUrl = await getBlobPresignedUrl(
        fileReference.key,
        5 * 60, // 5 minutes
        {
          accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
          accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
          connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
          containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
        }
      )
    } else {
      throw new Error('No cloud storage configured for execution files')
    }

    logger.info(`Generated download URL for execution file: ${fileReference.name}`)
    return downloadUrl
  } catch (error) {
    logger.error(`Failed to generate download URL for ${fileReference.name}:`, error)
    throw new Error(
      `Failed to generate download URL: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Delete a file from execution-scoped storage
 */
export async function deleteExecutionFile(fileReference: FileReference): Promise<void> {
  logger.info(`Deleting execution file: ${fileReference.name}`)

  try {
    if (USE_S3_STORAGE) {
      await deleteFromS3(fileReference.key, {
        bucket: S3_EXECUTION_FILES_CONFIG.bucket,
        region: S3_EXECUTION_FILES_CONFIG.region,
      })
    } else if (USE_BLOB_STORAGE) {
      await deleteFromBlob(fileReference.key, {
        accountName: BLOB_EXECUTION_FILES_CONFIG.accountName,
        accountKey: BLOB_EXECUTION_FILES_CONFIG.accountKey,
        connectionString: BLOB_EXECUTION_FILES_CONFIG.connectionString,
        containerName: BLOB_EXECUTION_FILES_CONFIG.containerName,
      })
    } else {
      throw new Error('No cloud storage configured for execution files')
    }

    logger.info(`Successfully deleted execution file: ${fileReference.name}`)
  } catch (error) {
    logger.error(`Failed to delete execution file ${fileReference.name}:`, error)
    throw new Error(
      `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
