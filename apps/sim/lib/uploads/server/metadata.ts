import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import type { StorageContext } from '../shared/types'

const logger = createLogger('FileMetadata')

export type FileMetadataRecord = typeof workspaceFiles.$inferSelect

export interface FileMetadataInsertOptions {
  key: string
  userId: string
  workspaceId?: string | null
  context: StorageContext
  originalName: string
  contentType: string
  size: number
  /** Optional — a UUID is generated when omitted. */
  id?: string
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
    const [restored] = await db
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
      .returning()

    if (restored) {
      return restored
    }
  }

  const existing = await db
    .select()
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.key, key), isNull(workspaceFiles.deletedAt)))
    .limit(1)

  if (existing.length > 0) {
    return existing[0]
  }

  const fileId = id || generateId()

  try {
    const [inserted] = await db
      .insert(workspaceFiles)
      .values({
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
      .returning()

    return inserted
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === '23505' || (error instanceof Error && error.message.includes('unique'))) {
      const existingAfterError = await db
        .select()
        .from(workspaceFiles)
        .where(and(eq(workspaceFiles.key, key), isNull(workspaceFiles.deletedAt)))
        .limit(1)

      if (existingAfterError.length > 0) {
        return existingAfterError[0]
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

  return record ?? null
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

  return db
    .select()
    .from(workspaceFiles)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .orderBy(workspaceFiles.uploadedAt)
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
