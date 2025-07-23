/**
 * Server-only execution file metadata management
 * This file contains database operations and should only be imported by server-side code
 */

import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflowExecutionLogs } from '@/db/schema'
import type { ExecutionFileMetadata } from './execution-files-types'

const logger = createLogger('ExecutionFilesServer')

// File conversion is now handled by the enhanced logger
// This file is kept for cleanup functions only

/**
 * Retrieve file metadata from execution logs
 */
export async function getExecutionFiles(executionId: string): Promise<ExecutionFileMetadata[]> {
  try {
    const log = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (log.length === 0) {
      return []
    }

    // Get files from the dedicated files column
    return (log[0].files as ExecutionFileMetadata[]) || []
  } catch (error) {
    logger.error(`Failed to retrieve file metadata for execution ${executionId}:`, error)
    return []
  }
}

/**
 * Get all expired files across all executions
 */
export async function getExpiredFiles(): Promise<ExecutionFileMetadata[]> {
  try {
    const now = new Date().toISOString()

    // Query all execution logs that have files
    const logs = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.level, 'info')) // Only get successful executions

    const expiredFiles: ExecutionFileMetadata[] = []

    for (const log of logs) {
      const files = log.files as ExecutionFileMetadata[]
      if (files) {
        const expired = files.filter((file) => file.expiresAt < now)
        expiredFiles.push(...expired)
      }
    }

    return expiredFiles
  } catch (error) {
    logger.error('Failed to get expired files:', error)
    return []
  }
}

/**
 * Remove expired file metadata from execution logs
 */
export async function cleanupExpiredFileMetadata(): Promise<number> {
  try {
    const now = new Date().toISOString()
    let cleanedCount = 0

    // Get all execution logs
    const logs = await db.select().from(workflowExecutionLogs)

    for (const log of logs) {
      const files = log.files as ExecutionFileMetadata[]
      if (files && files.length > 0) {
        const nonExpiredFiles = files.filter((file) => file.expiresAt >= now)

        if (nonExpiredFiles.length !== files.length) {
          // Some files expired, update the files column
          await db
            .update(workflowExecutionLogs)
            .set({ files: nonExpiredFiles.length > 0 ? nonExpiredFiles : null })
            .where(eq(workflowExecutionLogs.id, log.id))

          cleanedCount += files.length - nonExpiredFiles.length
        }
      }
    }

    logger.info(`Cleaned up ${cleanedCount} expired file metadata entries`)
    return cleanedCount
  } catch (error) {
    logger.error('Failed to cleanup expired file metadata:', error)
    return 0
  }
}

// Helper functions moved to enhanced logger

/**
 * Delete expired files from cloud storage
 */
export async function deleteExpiredFilesFromStorage(
  expiredFiles: ExecutionFileMetadata[]
): Promise<{
  deleted: number
  failed: number
}> {
  let deleted = 0
  let failed = 0

  if (expiredFiles.length === 0) {
    return { deleted, failed }
  }

  // Group files by storage provider for efficient batch operations
  const s3Files = expiredFiles.filter((f) => f.storageProvider === 's3')
  const blobFiles = expiredFiles.filter((f) => f.storageProvider === 'blob')
  const localFiles = expiredFiles.filter((f) => f.storageProvider === 'local')

  // Delete S3 files in batch
  if (s3Files.length > 0) {
    try {
      const { getS3Client } = await import('@/lib/uploads/s3/s3-client')
      const { S3_EXECUTION_FILES_CONFIG } = await import('@/lib/uploads/setup')
      const { DeleteObjectsCommand } = await import('@aws-sdk/client-s3')

      const s3Client = getS3Client()

      // S3 allows up to 1000 objects per delete request
      const batchSize = 1000
      for (let i = 0; i < s3Files.length; i += batchSize) {
        const batch = s3Files.slice(i, i + batchSize)

        const deleteCommand = new DeleteObjectsCommand({
          Bucket: S3_EXECUTION_FILES_CONFIG.bucket,
          Delete: {
            Objects: batch.map((file) => ({ Key: file.fileKey })),
            Quiet: true,
          },
        })

        await s3Client.send(deleteCommand)
        deleted += batch.length
        logger.info(`Deleted batch of ${batch.length} expired S3 files`)
      }
    } catch (error) {
      logger.error('Failed to delete expired S3 files:', error)
      failed += s3Files.length
    }
  }

  // Delete Azure Blob files individually
  if (blobFiles.length > 0) {
    try {
      const { getBlobServiceClient } = await import('@/lib/uploads/blob/blob-client')
      const { BLOB_CONFIG } = await import('@/lib/uploads/setup')

      const blobServiceClient = getBlobServiceClient()
      const containerClient = blobServiceClient.getContainerClient(BLOB_CONFIG.containerName)

      const deletePromises = blobFiles.map(async (file) => {
        try {
          const blockBlobClient = containerClient.getBlockBlobClient(file.fileKey)
          await blockBlobClient.delete()
          return true
        } catch (error) {
          logger.error(`Failed to delete expired blob file ${file.fileKey}:`, error)
          return false
        }
      })

      const results = await Promise.all(deletePromises)
      deleted += results.filter((r) => r).length
      failed += results.filter((r) => !r).length

      logger.info(`Deleted ${results.filter((r) => r).length} expired blob files`)
    } catch (error) {
      logger.error('Failed to delete expired blob files:', error)
      failed += blobFiles.length
    }
  }

  // Delete local files
  if (localFiles.length > 0) {
    try {
      const { UPLOAD_DIR } = await import('@/lib/uploads/setup')
      const { unlink } = await import('fs/promises')
      const { join } = await import('path')

      for (const file of localFiles) {
        try {
          const filePath = join(UPLOAD_DIR, file.fileKey)
          await unlink(filePath)
          deleted++
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            // Ignore "file not found" errors
            logger.error(`Failed to delete expired local file ${file.fileKey}:`, error)
          }
          failed++
        }
      }

      logger.info(`Deleted ${deleted} expired local files`)
    } catch (error) {
      logger.error('Failed to delete expired local files:', error)
      failed += localFiles.length
    }
  }

  return { deleted, failed }
}

// Helper functions moved to enhanced logger
