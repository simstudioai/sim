import { db } from '@sim/db'
import { type WorkspaceFileRow, workspaceFileColumns, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import {
  getWorkspaceFileSize,
  isWorkspaceScopedContext,
  type StorageContext,
} from '@/lib/uploads/shared/types'
import { inferContextFromKey } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('FileMetadata')

export type FileMetadataRecord = WorkspaceFileRow

export interface FileMetadataInsertOptions {
  key: string
  userId: string
  workspaceId?: string | null
  organizationId?: string | null
  context: StorageContext
  originalName: string
  contentType: string
  size: number
  folderId?: string | null
  /** Optional — a UUID is generated when omitted. */
  id?: string
}

export class ActiveFileMetadataKeyConflictError extends Error {
  readonly code = 'ACTIVE_FILE_KEY_EXISTS' as const

  constructor(key: string) {
    super(`Storage key ${key} is already registered to an active file`)
  }
}

/** Organization file bindings are restricted to connector caches, never personal uploads. */
function assertFileMetadataOrganizationOwner(options: FileMetadataInsertOptions): void {
  if (
    options.organizationId &&
    (options.workspaceId ||
      options.folderId ||
      options.context !== 'knowledge-base' ||
      inferContextFromKey(options.key) !== 'knowledge-base')
  ) {
    throw new Error(
      'Organization file bindings require knowledge-base context and no workspace or folder'
    )
  }
}

function isSameFileMetadataInsert(
  existing: FileMetadataRecord,
  options: FileMetadataInsertOptions
): boolean {
  return (
    existing.key === options.key &&
    existing.userId === options.userId &&
    existing.workspaceId === (options.workspaceId ?? null) &&
    (existing.organizationId ?? null) === (options.organizationId ?? null) &&
    existing.folderId === (options.folderId ?? null) &&
    existing.context === options.context &&
    existing.originalName === options.originalName &&
    existing.contentType === options.contentType &&
    getWorkspaceFileSize(existing) === options.size &&
    existing.deletedAt === null &&
    (options.id === undefined || existing.id === options.id)
  )
}

function isSameFileMetadataRequest(
  left: FileMetadataInsertOptions,
  right: FileMetadataInsertOptions
): boolean {
  return (
    left.key === right.key &&
    left.userId === right.userId &&
    (left.workspaceId ?? null) === (right.workspaceId ?? null) &&
    (left.organizationId ?? null) === (right.organizationId ?? null) &&
    (left.folderId ?? null) === (right.folderId ?? null) &&
    left.context === right.context &&
    left.originalName === right.originalName &&
    left.contentType === right.contentType &&
    left.size === right.size &&
    (left.id ?? null) === (right.id ?? null)
  )
}

async function findActiveFileMetadataByKey(
  executor: DbOrTx,
  key: string
): Promise<FileMetadataRecord | undefined> {
  const [record] = await executor
    .select(workspaceFileColumns)
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.key, key), isNull(workspaceFiles.deletedAt)))
    .limit(1)
  return record
}

function resolveExistingFileMetadata(
  existing: FileMetadataRecord,
  options: FileMetadataInsertOptions
): FileMetadataRecord {
  if (!isSameFileMetadataInsert(existing, options)) {
    throw new ActiveFileMetadataKeyConflictError(options.key)
  }
  return existing
}

async function insertFileMetadataWithExecutor(
  executor: DbOrTx,
  options: FileMetadataInsertOptions,
  requireExactActiveIdentity: boolean
): Promise<FileMetadataRecord> {
  const {
    key,
    userId,
    workspaceId,
    organizationId,
    context,
    originalName,
    contentType,
    size,
    folderId,
    id,
  } = options

  assertFileMetadataOrganizationOwner(options)
  const active = await findActiveFileMetadataByKey(executor, key)
  if (active) {
    return requireExactActiveIdentity || active.organizationId
      ? resolveExistingFileMetadata(active, options)
      : active
  }

  const [existingDeleted] = await executor
    .select(workspaceFileColumns)
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.key, key), isNotNull(workspaceFiles.deletedAt)))
    .limit(1)

  if (existingDeleted) {
    if (requireExactActiveIdentity || existingDeleted.organizationId) {
      resolveExistingFileMetadata({ ...existingDeleted, deletedAt: null }, options)
    }
    const [restored] = await executor
      .update(workspaceFiles)
      .set({
        userId,
        workspaceId: workspaceId || null,
        organizationId: organizationId || null,
        folderId: folderId ?? null,
        context,
        originalName,
        displayName: originalName,
        contentType,
        sizeBytes: size,
        deletedAt: null,
        uploadedAt: new Date(),
        contentUpdatedAt: sql<Date>`GREATEST(CURRENT_TIMESTAMP, ${workspaceFiles.contentUpdatedAt} + INTERVAL '1 millisecond')`,
      })
      .where(eq(workspaceFiles.id, existingDeleted.id))
      .returning(workspaceFileColumns)

    if (restored) {
      return restored
    }
  }

  const fileId = id || generateId()

  try {
    const [inserted] = await executor
      .insert(workspaceFiles)
      .values({
        id: fileId,
        key,
        userId,
        workspaceId: workspaceId || null,
        organizationId: organizationId || null,
        folderId: folderId ?? null,
        context,
        originalName,
        displayName: originalName,
        contentType,
        sizeBytes: size,
        deletedAt: null,
        uploadedAt: new Date(),
      })
      .returning(workspaceFileColumns)

    if (!inserted) {
      throw new Error(`Failed to insert file metadata for key: ${key}`)
    }
    return inserted
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    if (code === '23505' || (error instanceof Error && error.message.includes('unique'))) {
      const existingAfterError = await findActiveFileMetadataByKey(executor, key)
      if (existingAfterError) {
        return requireExactActiveIdentity || existingAfterError.organizationId
          ? resolveExistingFileMetadata(existingAfterError, options)
          : existingAfterError
      }
    }

    logger.error(`Failed to insert file metadata for key: ${key}`, error)
    throw error
  }
}

async function insertImmutableFileMetadataWithExecutor(
  executor: DbOrTx,
  options: FileMetadataInsertOptions
): Promise<FileMetadataRecord> {
  const {
    key,
    userId,
    workspaceId,
    organizationId,
    context,
    originalName,
    contentType,
    size,
    folderId,
    id,
  } = options
  assertFileMetadataOrganizationOwner(options)
  const [inserted] = await executor
    .insert(workspaceFiles)
    .values({
      id: id || generateId(),
      key,
      userId,
      workspaceId: workspaceId || null,
      organizationId: organizationId || null,
      folderId: folderId ?? null,
      context,
      originalName,
      displayName: originalName,
      contentType,
      sizeBytes: size,
      deletedAt: null,
      uploadedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning(workspaceFileColumns)

  if (inserted) return inserted

  const active = await findActiveFileMetadataByKey(executor, key)
  if (!active) throw new ActiveFileMetadataKeyConflictError(key)
  return resolveExistingFileMetadata(active, options)
}

/**
 * Inserts file metadata while retaining the legacy active-key reuse behavior.
 * Internal replacement flows use deterministic storage keys and may write new
 * bytes before reaching metadata persistence, so existing callers must remain
 * idempotent even when the replacement's size or content type changed.
 */
export async function insertFileMetadata(
  options: FileMetadataInsertOptions
): Promise<FileMetadataRecord> {
  return insertFileMetadataWithExecutor(db, options, Boolean(options.organizationId))
}

/**
 * Inserts metadata for a create-only object and accepts an active-key retry
 * only when the complete ownership and file identity are unchanged.
 */
export async function insertImmutableFileMetadata(
  options: FileMetadataInsertOptions
): Promise<FileMetadataRecord> {
  return insertFileMetadataWithExecutor(db, options, true)
}

/**
 * Bulk-insert file metadata rows in a single statement.
 *
 * Intended for batch upload flows that create many fresh keys at once (e.g. the
 * presigned batch route), replacing a fan-out of individual `insertFileMetadata`
 * calls. Uses `ON CONFLICT DO NOTHING` on the active-key unique index, so it is
 * safe against a concurrent single insert. Already-present active keys are
 * accepted only when every ownership and file-identity field matches; any
 * mismatch is rejected. Unlike {@link insertFileMetadata} it does NOT restore
 * soft-deleted rows — callers use this only for newly generated keys.
 */
export async function insertFileMetadataMany(
  rows: Array<Omit<FileMetadataInsertOptions, 'id'> & { id?: string }>
): Promise<void> {
  if (rows.length === 0) {
    return
  }

  const uniqueRowsByKey = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    assertFileMetadataOrganizationOwner(row)
    const existing = uniqueRowsByKey.get(row.key)
    if (existing && !isSameFileMetadataRequest(existing, row)) {
      throw new ActiveFileMetadataKeyConflictError(row.key)
    }
    uniqueRowsByKey.set(row.key, existing ?? row)
  }
  const uniqueRows = [...uniqueRowsByKey.values()]

  const inserted = await db
    .insert(workspaceFiles)
    .values(
      uniqueRows.map((row) => ({
        id: row.id || generateId(),
        key: row.key,
        userId: row.userId,
        workspaceId: row.workspaceId || null,
        organizationId: row.organizationId || null,
        folderId: row.folderId ?? null,
        context: row.context,
        originalName: row.originalName,
        displayName: row.originalName,
        contentType: row.contentType,
        sizeBytes: row.size,
        deletedAt: null,
        uploadedAt: new Date(),
      }))
    )
    .onConflictDoNothing()
    .returning(workspaceFileColumns)

  const insertedKeys = new Set(inserted.map((record) => record.key))
  const conflictingRows = uniqueRows.filter((row) => !insertedKeys.has(row.key))
  if (conflictingRows.length > 0) {
    const activeRows = await db
      .select(workspaceFileColumns)
      .from(workspaceFiles)
      .where(
        and(
          inArray(
            workspaceFiles.key,
            conflictingRows.map((row) => row.key)
          ),
          isNull(workspaceFiles.deletedAt)
        )
      )
    const activeByKey = new Map(activeRows.map((record) => [record.key, record]))
    for (const row of conflictingRows) {
      const active = activeByKey.get(row.key)
      if (!active) {
        throw new ActiveFileMetadataKeyConflictError(row.key)
      }
      resolveExistingFileMetadata(active, row)
    }
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
    .select(workspaceFileColumns)
    .from(workspaceFiles)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    // Prefer the active row when includeDeleted lets both an active and a
    // soft-deleted row for the same key match.
    .orderBy(sql`${workspaceFiles.deletedAt} IS NULL DESC`)
    .limit(1)

  return record ?? null
}

/**
 * Resolve the storage context a stored object must be read and authorized under.
 * This is the sanctioned way to ask that question — `inferContextFromKey` alone
 * answers only bucket and tenancy (see its contract).
 *
 * The two layers divide as follows. The key prefix is authoritative for *where
 * the bytes live*: it is written server-side at upload and cannot be forged to
 * change tenant. `workspace_files.context` is authoritative for *which module
 * owns the object*: it too is server-authored, but unlike the key it is mutable,
 * which it has to be — `materialize_file` promotes a chat attachment to a
 * workspace file by flipping that column, and rewriting the storage key on every
 * such transition would mean copying the bytes to say the same thing twice.
 *
 * So only the `workspace/` prefix is ambiguous — it carries the two
 * `WORKSPACE_SCOPED_CONTEXTS` — and only it costs a lookup. Every other prefix
 * maps to exactly one module and returns immediately.
 *
 * An unbound key keeps its inferred context: absent metadata is not evidence of
 * anything, and the caller's own not-found handling is the right answer.
 */
export async function resolveStoredFileContext(key: string): Promise<StorageContext> {
  const inferred = inferContextFromKey(key)
  if (inferred !== 'workspace') return inferred

  const metadata = await getFileMetadataByKey(key)
  return isWorkspaceScopedContext(metadata?.context) ? metadata.context : inferred
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
    .select(workspaceFileColumns)
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
    .select(workspaceFileColumns)
    .from(workspaceFiles)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .limit(1)
  return record ?? null
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
 * Soft-deletes only the active metadata version previously authorized by a caller.
 * Postgres timestamps are compared at JavaScript `Date` precision because a selected
 * microsecond timestamp has already been rounded to milliseconds at this boundary.
 */
export async function deleteFileMetadataByIdentity(identity: {
  id: string
  key: string
  context: StorageContext
  contentUpdatedAt: Date
}): Promise<boolean> {
  const deleted = await db
    .update(workspaceFiles)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(workspaceFiles.id, identity.id),
        eq(workspaceFiles.key, identity.key),
        eq(workspaceFiles.context, identity.context),
        eq(
          sql<Date>`date_trunc('milliseconds', ${workspaceFiles.contentUpdatedAt})`,
          identity.contentUpdatedAt
        ),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .returning({ id: workspaceFiles.id })
  return deleted.length === 1
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
 * the binding shape for knowledge upload sessions — keep all callers routed
 * through here so they cannot drift.
 */
export async function recordKnowledgeBaseFileOwnership(
  ownership: KnowledgeBaseFileOwnership,
  executor?: DbTransaction
): Promise<void> {
  if (!executor) {
    await insertImmutableFileMetadata({ ...ownership, context: 'knowledge-base' })
    return
  }
  await insertImmutableFileMetadataWithExecutor(executor, {
    ...ownership,
    context: 'knowledge-base',
  })
}
