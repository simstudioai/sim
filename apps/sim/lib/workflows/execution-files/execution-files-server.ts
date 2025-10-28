/**
 * Server-only execution file metadata management
 * This file contains database operations and should only be imported by server-side code
 */

import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionFileMetadata } from './execution-files'

const logger = createLogger('ExecutionFilesServer')

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
 * Store file metadata in execution logs
 */
export async function storeExecutionFiles(
  executionId: string,
  files: ExecutionFileMetadata[]
): Promise<void> {
  try {
    logger.info(`Storing ${files.length} file metadata entries for execution ${executionId}`)

    await db
      .update(workflowExecutionLogs)
      .set({ files })
      .where(eq(workflowExecutionLogs.executionId, executionId))

    logger.info(`Successfully stored file metadata for execution ${executionId}`)
  } catch (error) {
    logger.error(`Failed to store file metadata for execution ${executionId}:`, error)
    throw error
  }
}

/**
 * Add file metadata to existing execution logs
 */
export async function addExecutionFile(
  executionId: string,
  fileMetadata: ExecutionFileMetadata
): Promise<void> {
  try {
    // Get existing files
    const existingFiles = await getExecutionFiles(executionId)

    // Add new file
    const updatedFiles = [...existingFiles, fileMetadata]

    // Store updated files
    await storeExecutionFiles(executionId, updatedFiles)

    logger.info(`Added file ${fileMetadata.name} to execution ${executionId}`)
  } catch (error) {
    logger.error(`Failed to add file to execution ${executionId}:`, error)
    throw error
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
