import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, sql } from 'drizzle-orm'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import type { DbTransaction } from '@/lib/db/types'
import {
  enqueueKnowledgeStorageCleanup,
  isKnowledgeBaseOwnedStorageKey,
  KNOWLEDGE_STORAGE_CLEANUP_EVENT,
} from '@/lib/knowledge/documents/storage-cleanup'
import { StorageService } from '@/lib/uploads'
import { insertImmutableFileMetadata } from '@/lib/uploads/server/metadata'

const UPLOAD_TIMEOUT_MS = 120_000
const ORPHAN_GRACE_MS = 5 * 60_000

/**
 * Reserves an immutable binding and its cleanup intent before any object write.
 * The guard survives crashes before upload, after upload, and before document attachment.
 */
export async function uploadKnowledgeArtifact(input: {
  documentId: string
  key: string
  owner: ResourceOwner & { userId: string }
  artifact: { bytes: Buffer; fileName: string; mimeType: string }
  signal?: AbortSignal
}) {
  const { documentId, key, owner, artifact } = input
  input.signal?.throwIfAborted()
  if (owner.workspaceId || owner.organizationId) resourceScopeFromOwner(owner)
  if (!owner.userId) throw new Error('Knowledge upload requires its canonical user owner')
  if (!isKnowledgeBaseOwnedStorageKey(key)) {
    throw new Error('Knowledge upload requires a canonical knowledge-base storage key')
  }
  const metadataId = generateId()
  const uploadId = generateId()
  const { binding, cleanupEventId } = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`)
    await tx.execute(sql`SET LOCAL statement_timeout = '15s'`)
    const reserved = await insertImmutableFileMetadata(
      {
        id: metadataId,
        key,
        userId: owner.userId,
        workspaceId: owner.workspaceId,
        organizationId: owner.organizationId,
        originalName: artifact.fileName,
        contentType: artifact.mimeType,
        size: artifact.bytes.length,
        context: 'knowledge-base',
      },
      tx
    )
    if (reserved.id !== metadataId) throw new Error('Knowledge upload storage key is already bound')
    const [cleanupEventId] = await enqueueKnowledgeStorageCleanup(
      tx,
      [{ id: documentId, fileUrl: `/api/files/serve/${encodeURIComponent(key)}`, ...owner }],
      documentId,
      {
        availableAt: new Date(Date.now() + ORPHAN_GRACE_MS),
        reason: 'uncommitted-upload',
        uploadId,
      }
    )
    if (!cleanupEventId) throw new Error('Knowledge upload cleanup guard was not created')
    return { binding: reserved, cleanupEventId }
  })

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error('Knowledge storage upload timed out')),
    UPLOAD_TIMEOUT_MS
  )
  const signal = input.signal
    ? AbortSignal.any([controller.signal, input.signal])
    : controller.signal
  try {
    signal.throwIfAborted()
    const file = await StorageService.uploadFile({
      file: artifact.bytes,
      fileName: artifact.fileName,
      contentType: artifact.mimeType,
      context: 'knowledge-base',
      customKey: key,
      preserveKey: true,
      metadata: {
        userId: owner.userId,
        ...(owner.workspaceId ? { workspaceId: owner.workspaceId } : {}),
        ...(owner.organizationId ? { organizationId: owner.organizationId } : {}),
        originalName: artifact.fileName,
      },
      persistMetadata: false,
      createOnlyUploadId: uploadId,
      signal,
    })
    signal.throwIfAborted()
    if (file.key !== key) throw new Error('Knowledge upload changed its reserved storage key')
    return { ...file, metadataId, contentUpdatedAt: binding.contentUpdatedAt, cleanupEventId }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Retires the upload guard in its attachment transaction, taking its row lock
 * before KB/connector locks. A failed attachment rolls this change back so
 * orphan cleanup remains available; a successful one needs no cleanup job.
 */
export async function claimKnowledgeUploadForAttachment(
  tx: DbTransaction,
  cleanupEventId: string
): Promise<void> {
  const [guard] = await tx
    .update(outboxEvent)
    .set({ status: 'completed', processedAt: new Date(), lockedAt: null, lastError: null })
    .where(
      and(
        eq(outboxEvent.id, cleanupEventId),
        eq(outboxEvent.eventType, KNOWLEDGE_STORAGE_CLEANUP_EVENT),
        eq(outboxEvent.status, 'pending')
      )
    )
    .returning({ id: outboxEvent.id })
  if (!guard) throw new Error('Knowledge upload expired before it could be attached')
}
