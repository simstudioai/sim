import { db } from '@sim/db'
import { document, outboxEvent, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { OutboxHandler } from '@/lib/core/outbox/service'
import {
  type ResourceOwner,
  resourceScopeFromOwner,
  sameResourceScope,
} from '@/lib/core/resource-scope'
import type { DbOrTx } from '@/lib/db/types'
import { checkpointIo } from '@/lib/knowledge/documents/processing-checkpoint-io'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { deleteFileMetadataByIdentity, getFileMetadataByKeys } from '@/lib/uploads/server/metadata'
import { headProviderObject, uploadStorageProvider } from '@/lib/uploads/upload-session/provider'
import { extractStorageKey } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('KnowledgeStorageCleanup')
const ENQUEUE_BATCH_SIZE = 100
const STORAGE_TIMEOUT_MS = 15_000
export const KNOWLEDGE_STORAGE_CLEANUP_EVENT = 'knowledge.document.storage.cleanup'

export interface KnowledgeStorageCleanupDocument extends ResourceOwner {
  id: string
  fileUrl: string | null
  /** Canonical billed document owner for legacy personal knowledge bases. */
  userId?: string | null
}

const cleanupPayloadSchema = z
  .object({
    version: z.literal(1),
    documentId: z.string().min(1).max(256),
    fileId: z.string().min(1).max(256),
    key: z.string().min(1).max(2048),
    contentUpdatedAt: z.iso.datetime(),
    workspaceId: z.string().min(1).max(256).nullable(),
    organizationId: z.string().min(1).max(256).nullable(),
    /** Optional only for cleanup events written before personal ownership was represented. */
    userId: z.string().min(1).max(256).nullable().optional(),
    /** Pre-upload reservations delete only bytes written by their own create-only attempt. */
    uploadId: z.string().min(1).max(256).optional(),
  })
  .strict()

type CleanupOwner = ResourceOwner & { userId?: string | null }

/** Personal ownership must be asserted by the document, never inferred from the object being deleted. */
function assertCleanupOwner(owner: CleanupOwner): void {
  if (owner.workspaceId || owner.organizationId) {
    resourceScopeFromOwner(owner)
  } else if (!owner.userId) {
    throw new Error('Personal knowledge storage cleanup requires its canonical user owner')
  }
}

function sameCleanupOwner(binding: CleanupOwner, expected: CleanupOwner): boolean {
  if (expected.workspaceId || expected.organizationId) {
    if (!binding.workspaceId && !binding.organizationId) return false
    return sameResourceScope(resourceScopeFromOwner(binding), resourceScopeFromOwner(expected))
  }
  return !binding.workspaceId && !binding.organizationId && binding.userId === expected.userId
}

export function getKnowledgeBaseStorageKey(fileUrl: string | null): string | null {
  if (!fileUrl) return null
  try {
    const urlPath = new URL(fileUrl, 'http://localhost').pathname
    const key = extractStorageKey(urlPath)
    return key !== urlPath ? key : null
  } catch {
    return null
  }
}

export function isKnowledgeBaseOwnedStorageKey(key: string): boolean {
  return key.startsWith('kb/') || key.startsWith('knowledge-base/')
}

/**
 * Call inside the document mutation transaction. The durable intent survives
 * document deletion; only bounded immutable metadata identities enter the queue.
 */
export async function enqueueKnowledgeStorageCleanup(
  executor: DbOrTx,
  documents: readonly KnowledgeStorageCleanupDocument[],
  requestId: string,
  options?: { availableAt?: Date; reason?: 'uncommitted-upload'; uploadId?: string }
): Promise<string[]> {
  const eventIds: string[] = []
  for (let offset = 0; offset < documents.length; offset += ENQUEUE_BATCH_SIZE) {
    const entries = documents.slice(offset, offset + ENQUEUE_BATCH_SIZE).flatMap((doc) => {
      const key = getKnowledgeBaseStorageKey(doc.fileUrl)
      return key && isKnowledgeBaseOwnedStorageKey(key) ? [{ doc, key }] : []
    })
    if (!entries.length) continue
    const keys = [...new Set(entries.map(({ key }) => key))]
    const bindings = await getFileMetadataByKeys(keys, 'knowledge-base', executor)
    const byKey = new Map(bindings.map((binding) => [binding.key, binding]))
    const rows: (typeof outboxEvent.$inferInsert)[] = []
    for (const { doc, key } of entries) {
      const binding = byKey.get(key)
      if (!binding) {
        logger.warn('Cannot queue knowledge storage cleanup without an ownership binding', {
          requestId,
          documentId: doc.id,
        })
        continue
      }
      assertCleanupOwner(doc)
      if (!sameCleanupOwner(binding, doc)) {
        throw new Error('Storage ownership binding does not match the document owner')
      }
      const payload = cleanupPayloadSchema.parse({
        version: 1,
        documentId: doc.id,
        fileId: binding.id,
        key,
        contentUpdatedAt: binding.contentUpdatedAt.toISOString(),
        workspaceId: binding.workspaceId ?? null,
        organizationId: binding.organizationId ?? null,
        userId: doc.workspaceId || doc.organizationId ? null : doc.userId,
        ...(options?.uploadId ? { uploadId: options.uploadId } : {}),
      })
      rows.push({
        /** A prior release may have retained a shared object; each mutation needs its own intent. */
        id: `knowledge-storage-cleanup:${generateId()}`,
        eventType: KNOWLEDGE_STORAGE_CLEANUP_EVENT,
        payload,
        maxAttempts: 48,
        ...(options?.availableAt ? { availableAt: options.availableAt } : {}),
      })
    }
    if (rows.length) {
      const inserted = await executor
        .insert(outboxEvent)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: outboxEvent.id })
      eventIds.push(...inserted.map((row) => row.id))
    }
  }
  return eventIds
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  return (
    ('code' in error && (error.code === 'ENOENT' || error.code === 'NoSuchKey')) ||
    ('name' in error && error.name === 'NoSuchKey') ||
    ('statusCode' in error && error.statusCode === 404)
  )
}

/**
 * Keep the active binding locked until deletion finishes: registration/restoration
 * and document creation lock this same row. Failed I/O rolls back the tombstone,
 * and a retry after an ambiguous object deletion treats absence as success.
 */
export const cleanupKnowledgeStorage: OutboxHandler = async (rawPayload, context) => {
  const payload = cleanupPayloadSchema.parse(rawPayload)
  if (!isKnowledgeBaseOwnedStorageKey(payload.key)) {
    throw new Error('Knowledge storage cleanup requires a knowledge-base key')
  }
  assertCleanupOwner(payload)
  context.signal.throwIfAborted()
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)
    await tx.execute(sql`SET LOCAL statement_timeout = '20s'`)
    const [binding] = await tx
      .select({
        id: workspaceFiles.id,
        key: workspaceFiles.key,
        context: workspaceFiles.context,
        contentUpdatedAt: workspaceFiles.contentUpdatedAt,
        workspaceId: workspaceFiles.workspaceId,
        organizationId: workspaceFiles.organizationId,
        userId: workspaceFiles.userId,
      })
      .from(workspaceFiles)
      .where(and(eq(workspaceFiles.id, payload.fileId), isNull(workspaceFiles.deletedAt)))
      .for('update')
      .limit(1)
    context.signal.throwIfAborted()
    if (
      !binding ||
      binding.key !== payload.key ||
      binding.context !== 'knowledge-base' ||
      binding.contentUpdatedAt.toISOString() !== payload.contentUpdatedAt ||
      !sameCleanupOwner(binding, payload)
    )
      return

    const [reference] = await tx
      .select({ id: document.id })
      .from(document)
      .where(eq(document.storageKey, payload.key))
      .limit(1)
    if (reference) return

    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(STORAGE_TIMEOUT_MS)])
    signal.throwIfAborted()
    const object = payload.uploadId
      ? await checkpointIo(
          () =>
            headProviderObject({
              provider: uploadStorageProvider(),
              key: payload.key,
              context: 'knowledge-base',
            }),
          signal
        )
      : undefined
    if (!payload.uploadId || object?.uploadId === payload.uploadId) {
      try {
        await deleteFile({ key: payload.key, context: 'knowledge-base', signal })
      } catch (error) {
        signal.throwIfAborted()
        if (!isMissingObject(error)) throw error
      }
    }
    signal.throwIfAborted()
    const deleted = await deleteFileMetadataByIdentity(
      { ...binding, context: 'knowledge-base' },
      tx
    )
    if (!deleted) throw new Error('Knowledge storage cleanup lost its metadata identity')
  })
}
