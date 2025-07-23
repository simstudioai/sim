import { createLogger } from '@/lib/logs/console-logger'
import {
  deleteFile,
  downloadFile,
  getStorageProvider,
  uploadFile,
} from '@/lib/uploads/storage-client'
import type { ExecutionContext, WorkflowFileReference } from './execution-files-types'

const logger = createLogger('WorkflowFileManager')

// Re-export types for convenience
export type { ExecutionContext, WorkflowFileReference } from './execution-files-types'

/**
 * Manages files for workflow executions with execution-scoped storage
 */
export class WorkflowFileManager {
  private executionContext: ExecutionContext

  constructor(executionContext: ExecutionContext) {
    this.executionContext = executionContext
  }

  /**
   * Generate execution-scoped storage key
   */
  private generateStorageKey(fileName: string): string {
    const { workspaceId, workflowId, executionId } = this.executionContext
    const safeFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
    return `${workspaceId}/${workflowId}/${executionId}/${safeFileName}`
  }

  /**
   * Get execution prefix for cleanup operations
   */
  private getExecutionPrefix(): string {
    const { workspaceId, workflowId, executionId } = this.executionContext
    return `${workspaceId}/${workflowId}/${executionId}/`
  }

  /**
   * Upload a file to execution-scoped storage
   */
  async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    contentType: string
  ): Promise<WorkflowFileReference> {
    logger.info(`Uploading file ${fileName} to execution ${this.executionContext.executionId}`)

    // Generate execution-scoped storage key
    const storageKey = this.generateStorageKey(fileName)

    // Upload using existing storage infrastructure
    const fileInfo = await uploadFile(fileBuffer, storageKey, contentType, fileBuffer.length)

    // Generate a presigned URL for external services (24 hours expiry)
    let directUrl: string | undefined
    try {
      const { getPresignedUrl } = await import('@/lib/uploads/storage-client')
      directUrl = await getPresignedUrl(fileInfo.key, 24 * 60 * 60) // 24 hours
      logger.info(`Generated presigned URL for external access: ${fileName}`)
    } catch (error) {
      logger.warn(`Failed to generate presigned URL for ${fileName}:`, error)
      // Continue without directUrl - external services won't work but internal access will
    }

    // Convert to WorkflowFileReference
    return {
      path: fileInfo.path,
      directUrl, // Include presigned URL for external services
      key: fileInfo.key,
      name: fileName, // Keep original name for display
      size: fileBuffer.length,
      type: contentType,
      executionContext: this.executionContext,
    }
  }

  /**
   * Download a file from execution-scoped storage
   */
  async downloadFile(fileReference: WorkflowFileReference): Promise<Buffer> {
    logger.info(
      `Downloading file ${fileReference.name} from execution ${this.executionContext.executionId}`
    )
    return downloadFile(fileReference.key)
  }

  /**
   * Delete a specific file
   */
  async deleteFile(fileReference: WorkflowFileReference): Promise<void> {
    logger.info(
      `Deleting file ${fileReference.name} from execution ${this.executionContext.executionId}`
    )
    await deleteFile(fileReference.key)
  }

  /**
   * Clean up all files for this execution
   */
  async cleanupExecution(): Promise<void> {
    const provider = getStorageProvider()
    logger.info(`Cleaning up execution files using ${provider} storage`)

    try {
      if (provider === 's3') {
        await this.cleanupS3Files()
      } else if (provider === 'blob') {
        await this.cleanupBlobFiles()
      } else {
        // Local storage cleanup
        await this.cleanupLocalFiles()
      }
    } catch (error) {
      logger.error(`Failed to cleanup execution files:`, error)
      throw error
    }
  }

  /**
   * Clean up S3 files for this execution
   */
  private async cleanupS3Files(): Promise<void> {
    const prefix = this.getExecutionPrefix()
    logger.info(`Listing S3 objects with prefix: ${prefix}`)

    try {
      // Dynamic imports to avoid bundling server-side code for browser
      const { getS3Client } = await import('@/lib/uploads/s3/s3-client')
      const { S3_CONFIG } = await import('@/lib/uploads/setup')
      const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3')

      const s3Client = getS3Client()

      // List all objects with the execution prefix
      const listCommand = new ListObjectsV2Command({
        Bucket: S3_CONFIG.bucket,
        Prefix: prefix,
      })

      const listResponse = await s3Client.send(listCommand)

      if (!listResponse.Contents || listResponse.Contents.length === 0) {
        logger.info(`No files found with prefix ${prefix}`)
        return
      }

      logger.info(`Found ${listResponse.Contents.length} files to delete`)

      // Delete all objects in batches (S3 allows up to 1000 objects per delete request)
      const objectsToDelete = listResponse.Contents.map((obj) => ({ Key: obj.Key! }))

      // Split into batches of 1000
      const batchSize = 1000
      for (let i = 0; i < objectsToDelete.length; i += batchSize) {
        const batch = objectsToDelete.slice(i, i + batchSize)

        const deleteCommand = new DeleteObjectsCommand({
          Bucket: S3_CONFIG.bucket,
          Delete: {
            Objects: batch,
            Quiet: true, // Don't return info about each deleted object
          },
        })

        await s3Client.send(deleteCommand)
        logger.info(`Deleted batch of ${batch.length} files`)
      }

      logger.info(`Successfully deleted all files with prefix ${prefix}`)
    } catch (error) {
      logger.error(`Error cleaning up S3 files with prefix ${prefix}:`, error)
      throw error
    }
  }

  /**
   * Clean up Azure Blob files for this execution
   */
  private async cleanupBlobFiles(): Promise<void> {
    const prefix = this.getExecutionPrefix()
    logger.info(`Listing Azure Blob objects with prefix: ${prefix}`)

    try {
      // Dynamic imports to avoid bundling server-side code for browser
      const { getBlobServiceClient } = await import('@/lib/uploads/blob/blob-client')
      const { BLOB_CONFIG } = await import('@/lib/uploads/setup')

      const blobServiceClient = getBlobServiceClient()
      const containerClient = blobServiceClient.getContainerClient(BLOB_CONFIG.containerName)

      // List all blobs with the execution prefix
      const blobsToDelete: string[] = []

      for await (const blob of containerClient.listBlobsFlat({ prefix })) {
        if (blob.name) {
          blobsToDelete.push(blob.name)
        }
      }

      if (blobsToDelete.length === 0) {
        logger.info(`No blobs found with prefix ${prefix}`)
        return
      }

      logger.info(`Found ${blobsToDelete.length} blobs to delete`)

      // Delete all blobs (Azure doesn't have batch delete, so we delete individually)
      const deletePromises = blobsToDelete.map(async (blobName) => {
        const blockBlobClient = containerClient.getBlockBlobClient(blobName)
        await blockBlobClient.delete()
      })

      await Promise.all(deletePromises)
      logger.info(`Successfully deleted all ${blobsToDelete.length} blobs with prefix ${prefix}`)
    } catch (error) {
      logger.error(`Error cleaning up Azure Blob files with prefix ${prefix}:`, error)
      throw error
    }
  }

  /**
   * Clean up local files for this execution
   */
  private async cleanupLocalFiles(): Promise<void> {
    const prefix = this.getExecutionPrefix()
    logger.info(`Cleaning up local files with prefix: ${prefix}`)

    try {
      // Dynamic imports to avoid bundling server-side code for browser
      const { UPLOAD_DIR } = await import('@/lib/uploads/setup')
      const { readdir, unlink, stat } = await import('fs/promises')
      const { join } = await import('path')

      const executionDir = join(UPLOAD_DIR, prefix)

      try {
        const files = await readdir(executionDir)

        for (const file of files) {
          const filePath = join(executionDir, file)
          const fileStat = await stat(filePath)

          if (fileStat.isFile()) {
            await unlink(filePath)
            logger.info(`Deleted local file: ${filePath}`)
          }
        }

        logger.info(`Successfully cleaned up ${files.length} local files`)
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          logger.info(`No local files found for execution ${this.executionContext.executionId}`)
        } else {
          throw error
        }
      }
    } catch (error) {
      logger.error(`Error cleaning up local files with prefix ${prefix}:`, error)
      throw error
    }
  }
}

/**
 * Factory function to create a WorkflowFileManager instance
 */
export function createWorkflowFileManager(executionContext: ExecutionContext): WorkflowFileManager {
  return new WorkflowFileManager(executionContext)
}
