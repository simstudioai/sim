import { db } from '@sim/db'
import { generateId } from '@sim/utils/id'
import { sql } from 'drizzle-orm'
import { resourceScopeFromOwner } from '@/lib/core/resource-scope'
import type { KnowledgeBaseOwner } from '@/lib/knowledge/connectors/sync-persistence'
import {
  enqueueKnowledgeStorageCleanup,
  isKnowledgeBaseOwnedStorageKey,
} from '@/lib/knowledge/documents/storage-cleanup'
import { StorageService } from '@/lib/uploads'
import { insertImmutableFileMetadata } from '@/lib/uploads/server/metadata'

const UPLOAD_TIMEOUT_MS = 120_000
const ORPHAN_GRACE_MS = 5 * 60_000

/**
 * Reserves an immutable binding and its cleanup intent before any object write.
 * The guard survives crashes before upload, after upload, and before document attachment.
 */
export async function uploadConnectorArtifact(input: {
  documentId: string
  key: string
  owner: KnowledgeBaseOwner
  artifact: { bytes: Buffer; fileName: string; mimeType: string }
}) {
  const { documentId, key, owner, artifact } = input
  if (owner.workspaceId || owner.organizationId) resourceScopeFromOwner(owner)
  if (!owner.userId) throw new Error('Connector upload requires its canonical user owner')
  if (!isKnowledgeBaseOwnedStorageKey(key)) {
    throw new Error('Connector upload requires a canonical knowledge-base storage key')
  }
  const metadataId = generateId()
  const uploadId = generateId()
  const binding = await db.transaction(async (tx) => {
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
    if (reserved.id !== metadataId) throw new Error('Connector upload storage key is already bound')
    await enqueueKnowledgeStorageCleanup(
      tx,
      [{ id: documentId, fileUrl: `/api/files/serve/${encodeURIComponent(key)}`, ...owner }],
      documentId,
      {
        availableAt: new Date(Date.now() + ORPHAN_GRACE_MS),
        reason: 'uncommitted-upload',
        uploadId,
      }
    )
    return reserved
  })

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error('Connector storage upload timed out')),
    UPLOAD_TIMEOUT_MS
  )
  try {
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
      signal: controller.signal,
    })
    controller.signal.throwIfAborted()
    if (file.key !== key) throw new Error('Connector upload changed its reserved storage key')
    return { ...file, metadataId, contentUpdatedAt: binding.contentUpdatedAt }
  } finally {
    clearTimeout(timer)
  }
}
