import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
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
  folderId?: string | null
  /** Optional — a UUID is generated when omitted. */
  id?: string
}

interface FileMetadataQueryOptions {
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
  const { key, userId, workspaceId, context, originalName, contentType, size, folderId, id } =
    options

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
        folderId: folderId ?? null,
        context,
        originalName,
        displayName: originalName,
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
        folderId: folderId ?? null,
        context,
        originalName,
        displayName: originalName,
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
 * Bulk-insert file metadata rows in a single statement.
 *
 * Intended for batch upload flows that create many fresh keys at once (e.g. the
 * presigned batch route), replacing a fan-out of individual `insertFileMetadata`
 * calls. Uses `ON CONFLICT DO NOTHING` on the active-key unique index, so it is
 * safe against a concurrent single insert and idempotent for already-present
 * active keys. Unlike {@link insertFileMetadata} it does NOT restore
 * soft-deleted rows — callers use this only for newly generated keys.
 */
export async function insertFileMetadataMany(
  rows: Array<Omit<FileMetadataInsertOptions, 'id'> & { id?: string }>
): Promise<void> {
  if (rows.length === 0) {
    return
  }

  await db
    .insert(workspaceFiles)
    .values(
      rows.map((row) => ({
        id: row.id || generateId(),
        key: row.key,
        userId: row.userId,
        workspaceId: row.workspaceId || null,
        folderId: row.folderId ?? null,
        context: row.context,
        originalName: row.originalName,
        displayName: row.originalName,
        contentType: row.contentType,
        size: row.size,
        deletedAt: null,
        uploadedAt: new Date(),
      }))
    )
    .onConflictDoNothing()
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
    // Prefer the active row when includeDeleted lets both an active and a
    // soft-deleted row for the same key match.
    .orderBy(sql`${workspaceFiles.deletedAt} IS NULL DESC`)
    .limit(1)

  return record ?? null
}

/**
 * Get active (non-deleted) file metadata for multiple keys in a single query.
 * Batches what would otherwise be N `getFileMetadataByKey` calls.
 */
export async function getFileMetadataByKeys(
  keys: string[],
  context: StorageContext,
  executor: Pick<typeof db, 'select'> = db
): Promise<FileMetadataRecord[]> {
  if (keys.length === 0) {
    return []
  }
  return executor
    .select()
    .from(workspaceFiles)
    .where(
      and(
        inArray(workspaceFiles.key, keys),
        eq(workspaceFiles.context, context),
        isNull(workspaceFiles.deletedAt)
      )
    )
}

/**
 * Get file metadata by ID
 */
export async function getFileMetadataById(
  id: string,
  options?: { includeDeleted?: boolean }
): Promise<FileMetadataRecord | null> {
  const { includeDeleted = false } = options ?? {}
  const conditions = [eq(workspaceFiles.id, id)]
  if (!includeDeleted) conditions.push(isNull(workspaceFiles.deletedAt))
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
async function getFileMetadataByContext(
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

/**
 * Fields needed to record a trusted storage-key -> workspace ownership binding
 * for a knowledge-base file. The `context` is always `'knowledge-base'`, so it is
 * not part of this shape.
 */
export interface KnowledgeBaseFileOwnership {
  key: string
  userId: string
  workspaceId: string
  originalName: string
  contentType: string
  size: number
}

/**
 * Record the ownership binding for a single knowledge-base upload. KB file
 * authorization (`verifyKBFileAccess`) resolves the owning workspace from this
 * binding, so every KB object must have exactly one. Single source of truth for
 * the binding shape across the presigned, batch-presigned, and multipart upload
 * paths — keep all callers routed through here so they cannot drift.
 */
export async function recordKnowledgeBaseFileOwnership(
  ownership: KnowledgeBaseFileOwnership
): Promise<void> {
  await insertFileMetadata({ ...ownership, context: 'knowledge-base' })
}

/**
 * Bulk variant of {@link recordKnowledgeBaseFileOwnership} for batch upload flows.
 * Idempotent against the active-key unique index (ON CONFLICT DO NOTHING).
 */
export async function recordKnowledgeBaseFileOwnershipMany(
  ownerships: KnowledgeBaseFileOwnership[]
): Promise<void> {
  if (ownerships.length === 0) {
    return
  }
  await insertFileMetadataMany(
    ownerships.map((ownership) => ({ ...ownership, context: 'knowledge-base' }))
  )
}
