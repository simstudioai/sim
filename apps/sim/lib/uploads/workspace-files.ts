/**
 * Workspace file storage system
 * Files uploaded at workspace level persist indefinitely and are accessible across all workflows
 */

import { db } from '@sim/db'
import { workspaceFile } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  checkStorageQuota,
  decrementStorageUsage,
  incrementStorageUsage,
} from '@/lib/billing/storage'
import { createLogger } from '@/lib/logs/console/logger'
import { deleteFile, downloadFile } from '@/lib/uploads/storage-client'
import type { UserFile } from '@/executor/types'

const logger = createLogger('WorkspaceFileStorage')

export interface WorkspaceFileRecord {
  id: string
  workspaceId: string
  name: string
  key: string
  path: string // Full serve path including storage type
  url?: string // Presigned URL for external access (optional, regenerated as needed)
  size: number
  type: string
  uploadedBy: string
  uploadedAt: Date
}

/**
 * Generate workspace-scoped storage key
 * Pattern: {workspaceId}/{timestamp}-{filename}
 */
export function generateWorkspaceFileKey(workspaceId: string, fileName: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 9)
  const safeFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
  return `${workspaceId}/${timestamp}-${random}-${safeFileName}`
}

/**
 * Upload a file to workspace-scoped storage
 */
export async function uploadWorkspaceFile(
  workspaceId: string,
  userId: string,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string
): Promise<UserFile> {
  logger.info(`Uploading workspace file: ${fileName} for workspace ${workspaceId}`)

  // Check for duplicates
  const exists = await fileExistsInWorkspace(workspaceId, fileName)
  if (exists) {
    throw new Error(`A file named "${fileName}" already exists in this workspace`)
  }

  // Check storage quota
  const quotaCheck = await checkStorageQuota(userId, fileBuffer.length)

  if (!quotaCheck.allowed) {
    throw new Error(quotaCheck.error || 'Storage limit exceeded')
  }

  // Generate workspace-scoped storage key
  const storageKey = generateWorkspaceFileKey(workspaceId, fileName)
  const fileId = `wf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

  try {
    let uploadResult: any

    logger.info(`Generated storage key: ${storageKey}`)

    // Upload to storage using direct S3/Blob clients for custom config with skipTimestampPrefix
    const { USE_S3_STORAGE, USE_BLOB_STORAGE, S3_CONFIG, BLOB_CONFIG } = await import(
      '@/lib/uploads/setup'
    )

    if (USE_S3_STORAGE) {
      const { uploadToS3 } = await import('@/lib/uploads/s3/s3-client')
      // Use custom config overload with skipTimestampPrefix
      uploadResult = await uploadToS3(
        fileBuffer,
        storageKey,
        contentType,
        {
          bucket: S3_CONFIG.bucket,
          region: S3_CONFIG.region,
        },
        fileBuffer.length,
        true // skipTimestampPrefix = true
      )
    } else if (USE_BLOB_STORAGE) {
      const { uploadToBlob } = await import('@/lib/uploads/blob/blob-client')
      // Blob doesn't have skipTimestampPrefix, but we pass the full key
      uploadResult = await uploadToBlob(
        fileBuffer,
        storageKey,
        contentType,
        {
          accountName: BLOB_CONFIG.accountName,
          accountKey: BLOB_CONFIG.accountKey,
          connectionString: BLOB_CONFIG.connectionString,
          containerName: BLOB_CONFIG.containerName,
        },
        fileBuffer.length
      )
    } else {
      // Fallback to local file storage - reuse storage-client logic
      logger.info('Using local file storage for workspace file')
      const { writeFile } = await import('fs/promises')
      const { join } = await import('path')
      const { v4: uuidv4 } = await import('uuid')
      const { UPLOAD_DIR_SERVER } = await import('@/lib/uploads/setup.server')

      // Convert forward slashes in storageKey to underscores for local filesystem
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

      uploadResult = {
        path: `/api/files/serve/${uniqueKey}`,
        key: uniqueKey,
        name: fileName,
        size: fileBuffer.length,
        type: contentType,
      }
    }

    logger.info(`Upload returned key: ${uploadResult.key}`)

    // Store metadata in database - use the EXACT key from upload result
    await db.insert(workspaceFile).values({
      id: fileId,
      workspaceId,
      name: fileName,
      key: uploadResult.key, // This is what actually got stored in S3
      size: fileBuffer.length,
      type: contentType,
      uploadedBy: userId,
      uploadedAt: new Date(),
    })

    logger.info(`Successfully uploaded workspace file: ${fileName} with key: ${uploadResult.key}`)

    // Increment storage usage tracking
    try {
      await incrementStorageUsage(userId, fileBuffer.length)
    } catch (storageError) {
      logger.error(`Failed to update storage tracking:`, storageError)
      // Continue - don't fail upload if tracking fails
    }

    // Generate presigned URL (valid for 24 hours for initial access)
    const { getPresignedUrl, isUsingCloudStorage } = await import('@/lib/uploads')
    let presignedUrl: string | undefined

    if (isUsingCloudStorage()) {
      try {
        presignedUrl = await getPresignedUrl(uploadResult.key, 24 * 60 * 60) // 24 hours
      } catch (error) {
        logger.warn(`Failed to generate presigned URL for ${fileName}:`, error)
      }
    }

    // Return UserFile format (no expiry for workspace files)
    return {
      id: fileId,
      name: fileName,
      size: fileBuffer.length,
      type: contentType,
      url: presignedUrl || uploadResult.path, // Use presigned URL for external access
      key: uploadResult.key,
      uploadedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
    }
  } catch (error) {
    logger.error(`Failed to upload workspace file ${fileName}:`, error)
    throw new Error(
      `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Check if a file with the same name already exists in workspace
 */
export async function fileExistsInWorkspace(
  workspaceId: string,
  fileName: string
): Promise<boolean> {
  try {
    const existing = await db
      .select()
      .from(workspaceFile)
      .where(and(eq(workspaceFile.workspaceId, workspaceId), eq(workspaceFile.name, fileName)))
      .limit(1)

    return existing.length > 0
  } catch (error) {
    logger.error(`Failed to check file existence for ${fileName}:`, error)
    return false
  }
}

/**
 * List all files for a workspace
 */
export async function listWorkspaceFiles(workspaceId: string): Promise<WorkspaceFileRecord[]> {
  try {
    const files = await db
      .select()
      .from(workspaceFile)
      .where(eq(workspaceFile.workspaceId, workspaceId))
      .orderBy(workspaceFile.uploadedAt)

    // Add full serve path for each file (don't generate presigned URLs here)
    const { getServePathPrefix } = await import('@/lib/uploads')
    const pathPrefix = getServePathPrefix()

    return files.map((file) => ({
      ...file,
      path: `${pathPrefix}${encodeURIComponent(file.key)}`,
      // url will be generated on-demand during execution for external APIs
    }))
  } catch (error) {
    logger.error(`Failed to list workspace files for ${workspaceId}:`, error)
    return []
  }
}

/**
 * Get a specific workspace file
 */
export async function getWorkspaceFile(
  workspaceId: string,
  fileId: string
): Promise<WorkspaceFileRecord | null> {
  try {
    const files = await db
      .select()
      .from(workspaceFile)
      .where(and(eq(workspaceFile.id, fileId), eq(workspaceFile.workspaceId, workspaceId)))
      .limit(1)

    if (files.length === 0) return null

    // Add full serve path
    const { getServePathPrefix } = await import('@/lib/uploads')
    const pathPrefix = getServePathPrefix()

    return {
      ...files[0],
      path: `${pathPrefix}${encodeURIComponent(files[0].key)}`,
    }
  } catch (error) {
    logger.error(`Failed to get workspace file ${fileId}:`, error)
    return null
  }
}

/**
 * Download workspace file content
 */
export async function downloadWorkspaceFile(fileRecord: WorkspaceFileRecord): Promise<Buffer> {
  logger.info(`Downloading workspace file: ${fileRecord.name}`)

  try {
    const buffer = await downloadFile(fileRecord.key)
    logger.info(
      `Successfully downloaded workspace file: ${fileRecord.name} (${buffer.length} bytes)`
    )
    return buffer
  } catch (error) {
    logger.error(`Failed to download workspace file ${fileRecord.name}:`, error)
    throw new Error(
      `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Delete a workspace file (both from storage and database)
 */
export async function deleteWorkspaceFile(workspaceId: string, fileId: string): Promise<void> {
  logger.info(`Deleting workspace file: ${fileId}`)

  try {
    // Get file record first
    const fileRecord = await getWorkspaceFile(workspaceId, fileId)
    if (!fileRecord) {
      throw new Error('File not found')
    }

    // Delete from storage
    await deleteFile(fileRecord.key)

    // Delete from database
    await db
      .delete(workspaceFile)
      .where(and(eq(workspaceFile.id, fileId), eq(workspaceFile.workspaceId, workspaceId)))

    // Decrement storage usage tracking
    try {
      await decrementStorageUsage(fileRecord.uploadedBy, fileRecord.size)
    } catch (storageError) {
      logger.error(`Failed to update storage tracking:`, storageError)
      // Continue - don't fail deletion if tracking fails
    }

    logger.info(`Successfully deleted workspace file: ${fileRecord.name}`)
  } catch (error) {
    logger.error(`Failed to delete workspace file ${fileId}:`, error)
    throw new Error(
      `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
