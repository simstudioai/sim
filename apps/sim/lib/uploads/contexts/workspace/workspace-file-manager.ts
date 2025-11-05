/**
 * Workspace file storage system
 * Files uploaded at workspace level persist indefinitely and are accessible across all workflows
 */

import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  checkStorageQuota,
  decrementStorageUsage,
  incrementStorageUsage,
} from '@/lib/billing/storage'
import { createLogger } from '@/lib/logs/console/logger'
import {
  deleteFile,
  downloadFile,
  hasCloudStorage,
  uploadFile,
} from '@/lib/uploads/core/storage-service'
import { getFileMetadataByKey, insertFileMetadata } from '@/lib/uploads/server/metadata'
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
 * UUID pattern for validating workspace IDs
 */
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

/**
 * Workspace file key pattern: workspace/{workspaceId}/{timestamp}-{random}-{filename}
 */
const WORKSPACE_KEY_PATTERN = /^workspace\/([a-f0-9-]{36})\/(\d+)-([a-z0-9]+)-(.+)$/

/**
 * Check if a key matches workspace file pattern
 * Format: workspace/{workspaceId}/{timestamp}-{random}-{filename}
 */
export function matchesWorkspaceFilePattern(key: string): boolean {
  if (!key || key.startsWith('/api/') || key.startsWith('http')) {
    return false
  }
  return WORKSPACE_KEY_PATTERN.test(key)
}

/**
 * Parse workspace file key to extract workspace ID
 * Format: workspace/{workspaceId}/{timestamp}-{random}-{filename}
 * @returns workspaceId if key matches pattern, null otherwise
 */
export function parseWorkspaceFileKey(key: string): string | null {
  if (!matchesWorkspaceFilePattern(key)) {
    return null
  }

  const match = key.match(WORKSPACE_KEY_PATTERN)
  if (!match) {
    return null
  }

  const workspaceId = match[1]
  return UUID_PATTERN.test(workspaceId) ? workspaceId : null
}

/**
 * Generate workspace-scoped storage key with explicit prefix
 * Format: workspace/{workspaceId}/{timestamp}-{random}-{filename}
 */
export function generateWorkspaceFileKey(workspaceId: string, fileName: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 9)
  const safeFileName = fileName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '_')
  return `workspace/${workspaceId}/${timestamp}-${random}-${safeFileName}`
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

  const exists = await fileExistsInWorkspace(workspaceId, fileName)
  if (exists) {
    throw new Error(`A file named "${fileName}" already exists in this workspace`)
  }

  const quotaCheck = await checkStorageQuota(userId, fileBuffer.length)

  if (!quotaCheck.allowed) {
    throw new Error(quotaCheck.error || 'Storage limit exceeded')
  }

  const storageKey = generateWorkspaceFileKey(workspaceId, fileName)
  let fileId = `wf_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

  try {
    logger.info(`Generated storage key: ${storageKey}`)

    const metadata: Record<string, string> = {
      originalName: fileName,
      uploadedAt: new Date().toISOString(),
      purpose: 'workspace',
      userId: userId,
      workspaceId: workspaceId,
    }

    const uploadResult = await uploadFile({
      file: fileBuffer,
      fileName: storageKey, // Use the full storageKey as fileName
      contentType,
      context: 'workspace',
      preserveKey: true, // Don't add timestamp prefix
      customKey: storageKey, // Explicitly set the key
      metadata, // Pass metadata for cloud storage consistency
    })

    logger.info(`Upload returned key: ${uploadResult.key}`)

    const usingCloudStorage = hasCloudStorage()

    if (!usingCloudStorage) {
      const metadataRecord = await insertFileMetadata({
        id: fileId,
        key: uploadResult.key,
        userId,
        workspaceId,
        context: 'workspace',
        originalName: fileName,
        contentType,
        size: fileBuffer.length,
      })
      fileId = metadataRecord.id
      logger.info(`Stored metadata in database for local file: ${uploadResult.key}`)
    } else {
      const existing = await getFileMetadataByKey(uploadResult.key, 'workspace')

      if (!existing) {
        logger.warn(`Metadata not found for cloud file ${uploadResult.key}, inserting...`)
        const metadataRecord = await insertFileMetadata({
          id: fileId,
          key: uploadResult.key,
          userId,
          workspaceId,
          context: 'workspace',
          originalName: fileName,
          contentType,
          size: fileBuffer.length,
        })
        fileId = metadataRecord.id
      } else {
        fileId = existing.id
        logger.info(`Using existing metadata record for cloud file: ${uploadResult.key}`)
      }
    }

    logger.info(`Successfully uploaded workspace file: ${fileName} with key: ${uploadResult.key}`)

    try {
      await incrementStorageUsage(userId, fileBuffer.length)
    } catch (storageError) {
      logger.error(`Failed to update storage tracking:`, storageError)
    }

    const { getServePathPrefix } = await import('@/lib/uploads')
    const pathPrefix = getServePathPrefix()
    const serveUrl = `${pathPrefix}${encodeURIComponent(uploadResult.key)}?context=workspace`

    return {
      id: fileId,
      name: fileName,
      size: fileBuffer.length,
      type: contentType,
      url: serveUrl, // Use authenticated serve URL (enforces context)
      key: uploadResult.key,
      context: 'workspace',
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
      .from(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.originalName, fileName),
          eq(workspaceFiles.context, 'workspace')
        )
      )
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
      .from(workspaceFiles)
      .where(
        and(eq(workspaceFiles.workspaceId, workspaceId), eq(workspaceFiles.context, 'workspace'))
      )
      .orderBy(workspaceFiles.uploadedAt)

    const { getServePathPrefix } = await import('@/lib/uploads')
    const pathPrefix = getServePathPrefix()

    return files.map((file) => ({
      id: file.id,
      workspaceId: file.workspaceId || workspaceId, // Use query workspaceId as fallback (should never be null for workspace files)
      name: file.originalName,
      key: file.key,
      path: `${pathPrefix}${encodeURIComponent(file.key)}?context=workspace`,
      size: file.size,
      type: file.contentType,
      uploadedBy: file.userId,
      uploadedAt: file.uploadedAt,
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
      .from(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.id, fileId),
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.context, 'workspace')
        )
      )
      .limit(1)

    if (files.length === 0) return null

    const { getServePathPrefix } = await import('@/lib/uploads')
    const pathPrefix = getServePathPrefix()

    const file = files[0]
    return {
      id: file.id,
      workspaceId: file.workspaceId || workspaceId, // Use query workspaceId as fallback (should never be null for workspace files)
      name: file.originalName,
      key: file.key,
      path: `${pathPrefix}${encodeURIComponent(file.key)}?context=workspace`,
      size: file.size,
      type: file.contentType,
      uploadedBy: file.userId,
      uploadedAt: file.uploadedAt,
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
    const buffer = await downloadFile({
      key: fileRecord.key,
      context: 'workspace',
    })
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
    const fileRecord = await getWorkspaceFile(workspaceId, fileId)
    if (!fileRecord) {
      throw new Error('File not found')
    }

    await deleteFile({
      key: fileRecord.key,
      context: 'workspace',
    })

    await db
      .delete(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.id, fileId),
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.context, 'workspace')
        )
      )

    try {
      await decrementStorageUsage(fileRecord.uploadedBy, fileRecord.size)
    } catch (storageError) {
      logger.error(`Failed to update storage tracking:`, storageError)
    }

    logger.info(`Successfully deleted workspace file: ${fileRecord.name}`)
  } catch (error) {
    logger.error(`Failed to delete workspace file ${fileId}:`, error)
    throw new Error(
      `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
