import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { StorageContext } from '../shared/types'

const logger = createLogger('FileMetadata')

export interface FileMetadataRecord {
  id: string
  key: string
  userId: string
  workspaceId: string | null
  context: string
  originalName: string
  contentType: string
  size: number
  deletedAt?: Date | null
  uploadedAt: Date
}

export interface FileMetadataInsertOptions {
  key: string
  userId: string
  workspaceId?: string | null
  context: StorageContext
  originalName: string
  contentType: string
  size: number
  id?: string // Optional - will generate UUID if not provided
}

export interface FileMetadataQueryOptions {
  context?: StorageContext
  workspaceId?: string
  userId?: string
}

/**
 * Insert file metadata into workspaceFiles table
 * Handles duplicate key errors gracefully by returning existing record
 */
export async function insertFileMetadata(
  options: FileMetadataInsertOptions
): Promise<FileMetadataRecord> {
  const { key, userId, workspaceId, context, originalName, contentType, size, id } = options

  const existingDeleted = await db
    .select()
    .from(workspaceFiles)
    .where(eq(workspaceFiles.key, key))
    .limit(1)

  if (existingDeleted.length > 0 && existingDeleted[0].deletedAt) {
    await db
      .update(workspaceFiles)
      .set({
        userId,
        workspaceId: workspaceId || null,
        context,
        originalName,
        contentType,
        size,
        deletedAt: null,
        uploadedAt: new Date(),
      })
      .where(eq(workspaceFiles.id, existingDeleted[0].id))

    return {
      id: existingDeleted[0].id,
      key,
      userId,
      workspaceId: workspaceId || null,
      context,
      originalName,
      contentType,
      size,
      deletedAt: null,
      uploadedAt: new Date(),
    }
  }

  const existing = await db
    .select()
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.key, key), isNull(workspaceFiles.deletedAt)))
    .limit(1)

  if (existing.length > 0) {
    return {
      id: existing[0].id,
      key: existing[0].key,
      userId: existing[0].userId,
      workspaceId: existing[0].workspaceId,
      context: existing[0].context,
      originalName: existing[0].originalName,
      contentType: existing[0].contentType,
      size: existing[0].size,
      deletedAt: existing[0].deletedAt,
      uploadedAt: existing[0].uploadedAt,
    }
  }

  const fileId = id || (await import('uuid')).v4()

  try {
    await db.insert(workspaceFiles).values({
      id: fileId,
      key,
      userId,
      workspaceId: workspaceId || null,
      context,
      originalName,
      contentType,
      size,
      deletedAt: null,
      uploadedAt: new Date(),
    })

    return {
      id: fileId,
      key,
      userId,
      workspaceId: workspaceId || null,
      context,
      originalName,
      contentType,
      size,
      deletedAt: null,
      uploadedAt: new Date(),
    }
  } catch (error) {
    if (
      (error as any)?.code === '23505' ||
      (error instanceof Error && error.message.includes('unique'))
    ) {
      const existingAfterError = await db
        .select()
        .from(workspaceFiles)
        .where(and(eq(workspaceFiles.key, key), isNull(workspaceFiles.deletedAt)))
        .limit(1)

      if (existingAfterError.length > 0) {
        return {
          id: existingAfterError[0].id,
          key: existingAfterError[0].key,
          userId: existingAfterError[0].userId,
          workspaceId: existingAfterError[0].workspaceId,
          context: existingAfterError[0].context,
          originalName: existingAfterError[0].originalName,
          contentType: existingAfterError[0].contentType,
          size: existingAfterError[0].size,
          deletedAt: existingAfterError[0].deletedAt,
          uploadedAt: existingAfterError[0].uploadedAt,
        }
      }
    }

    logger.error(`Failed to insert file metadata for key: ${key}`, error)
    throw error
  }
}

/**
 * Get file metadata by key with optional context filter
 */
export async function getFileMetadataByKey(
  key: string,
  context?: StorageContext,
  options?: { includeDeleted?: boolean }
): Promise<FileMetadataRecord | null> {
  const { includeDeleted = false } = options ?? {}
  const conditions = [eq(workspaceFiles.key, key)]

  if (context) {
    conditions.push(eq(workspaceFiles.context, context))
  }

  if (!includeDeleted) {
    conditions.push(isNull(workspaceFiles.deletedAt))
  }

  const [record] = await db
    .select()
    .from(workspaceFiles)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .limit(1)

  if (!record) {
    return null
  }

  return {
    id: record.id,
    key: record.key,
    userId: record.userId,
    workspaceId: record.workspaceId,
    context: record.context,
    originalName: record.originalName,
    contentType: record.contentType,
    size: record.size,
    deletedAt: record.deletedAt,
    uploadedAt: record.uploadedAt,
  }
}

/**
 * Get file metadata by context with optional workspaceId/userId filters
 */
export async function getFileMetadataByContext(
  context: StorageContext,
  options?: FileMetadataQueryOptions & { includeDeleted?: boolean }
): Promise<FileMetadataRecord[]> {
  const conditions = [eq(workspaceFiles.context, context)]

  if (options?.workspaceId) {
    conditions.push(eq(workspaceFiles.workspaceId, options.workspaceId))
  }

  if (options?.userId) {
    conditions.push(eq(workspaceFiles.userId, options.userId))
  }

  if (!options?.includeDeleted) {
    conditions.push(isNull(workspaceFiles.deletedAt))
  }

  const records = await db
    .select()
    .from(workspaceFiles)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .orderBy(workspaceFiles.uploadedAt)

  return records.map((record) => ({
    id: record.id,
    key: record.key,
    userId: record.userId,
    workspaceId: record.workspaceId,
    context: record.context,
    originalName: record.originalName,
    contentType: record.contentType,
    size: record.size,
    deletedAt: record.deletedAt,
    uploadedAt: record.uploadedAt,
  }))
}

/**
 * Delete file metadata by key
 */
export async function deleteFileMetadata(key: string): Promise<boolean> {
  await db
    .update(workspaceFiles)
    .set({ deletedAt: new Date() })
    .where(and(eq(workspaceFiles.key, key), isNull(workspaceFiles.deletedAt)))
  return true
}
