import { db } from '@sim/db'
import { document, embedding, knowledgeBase } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import type { DocumentData } from '@/lib/knowledge/documents/service'
import { StorageService } from '@/lib/uploads'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'
import { extractStorageKey } from '@/lib/uploads/utils/file-utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
import type { DocumentTags, ExternalDocument } from '@/connectors/types'

const logger = createLogger('ConnectorSyncPersistence')

const MAX_SAFE_TITLE_LENGTH = 200

/** Sanitizes a document title for use in S3 storage keys. */
function sanitizeStorageTitle(title: string): string {
  return title.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, MAX_SAFE_TITLE_LENGTH)
}

/**
 * Sanitizes a source file's name for a storage key, keeping its extension.
 *
 * `sanitizeStorageTitle` truncates a long title outright, which for a source file
 * would cut the extension off the end — and the extension is what
 * `resolveStoredArtifactExtension` reads to pick a parser. Such a document would
 * still parse correctly by falling back to its display name, but only by luck;
 * preserving the suffix keeps the storage key authoritative for every file rather
 * than for most of them.
 */
function sanitizeStorageFileName(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) return sanitizeStorageTitle(fileName)

  const extension = sanitizeStorageTitle(fileName.slice(dotIndex))
  const base = sanitizeStorageTitle(fileName.slice(0, dotIndex)).slice(
    0,
    Math.max(1, MAX_SAFE_TITLE_LENGTH - extension.length)
  )
  return base + extension
}

/**
 * The bytes to store for a connector document, together with the name and type
 * that describe them.
 *
 * The stored object must declare the format it actually holds, because
 * `resolveStoredArtifactExtension` picks the parser off its storage key. A
 * connector that hands over the source file keeps that file's own name and type,
 * so the shared pipeline parses it exactly as an upload of the same file — which
 * is what routes PDFs to OCR. A connector that extracted text itself stores
 * `.txt`, since that is what the bytes now are; keeping the source extension
 * there would re-parse extracted text as the original binary.
 */
function connectorStoredArtifact(extDoc: ExternalDocument): {
  bytes: Buffer
  fileName: string
  mimeType: string
} {
  if (extDoc.sourceFile) {
    return {
      bytes: extDoc.sourceFile.bytes,
      fileName: sanitizeStorageFileName(extDoc.sourceFile.fileName),
      mimeType: extDoc.sourceFile.mimeType,
    }
  }
  return {
    bytes: Buffer.from(extDoc.content, 'utf-8'),
    fileName: `${sanitizeStorageTitle(extDoc.title)}.txt`,
    mimeType: 'text/plain',
  }
}
type KnowledgeBaseLockingTx = Pick<typeof db, 'execute' | 'select'>

async function isKnowledgeBaseActiveInTx(
  tx: KnowledgeBaseLockingTx,
  knowledgeBaseId: string
): Promise<boolean> {
  await tx.execute(sql`SELECT 1 FROM knowledge_base WHERE id = ${knowledgeBaseId} FOR UPDATE`)

  const rows = await tx
    .select({ id: knowledgeBase.id })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  return rows.length > 0
}

/**
 * Resolves tag values from connector metadata using the connector's mapTags function.
 * Translates semantic keys returned by mapTags to actual DB slots using the
 * tagSlotMapping stored in sourceConfig during connector creation.
 */
export function resolveTagMapping(
  connectorType: string,
  metadata: Record<string, unknown>,
  sourceConfig?: Record<string, unknown>
): Partial<DocumentTags> | undefined {
  const config = CONNECTOR_REGISTRY[connectorType]
  if (!config?.mapTags || !metadata) return undefined

  const semanticTags = config.mapTags(metadata)
  const mapping = sourceConfig?.tagSlotMapping as Record<string, string> | undefined
  if (!mapping || !semanticTags) return undefined

  const result: Partial<DocumentTags> = {}
  for (const [semanticKey, slot] of Object.entries(mapping)) {
    const value = semanticTags[semanticKey]
    ;(result as Record<string, unknown>)[slot] = value != null ? value : null
  }
  return result
}

/** Owning workspace + user for a knowledge base, resolved once per sync. */
export interface KnowledgeBaseOwner {
  workspaceId: string | null
  userId: string
}

/**
 * Build the storage `metadata` that records a trusted ownership binding for a
 * synced `kb/` object. Returns `undefined` for legacy null-workspace KBs (no
 * workspace-scoped ownership to bind), which `uploadFile` treats as "no binding".
 */
function kbOwnershipMetadata(
  kbOwner: KnowledgeBaseOwner,
  originalName: string
): { workspaceId: string; userId: string; originalName: string } | undefined {
  return kbOwner.workspaceId
    ? { workspaceId: kbOwner.workspaceId, userId: kbOwner.userId, originalName }
    : undefined
}

/** Builds a content-less `failed` document row for a skipped (e.g. oversized) file. */
function buildSkippedDocumentRow(
  knowledgeBaseId: string,
  connectorId: string,
  connectorType: string,
  extDoc: ExternalDocument,
  sourceConfig?: Record<string, unknown>
) {
  const reason = extDoc.skippedReason ?? 'Document was skipped during sync'
  const tagValues = extDoc.metadata
    ? resolveTagMapping(connectorType, extDoc.metadata, sourceConfig)
    : undefined
  // Connectors put the source size under either `fileSize` or `size`; accept both
  // so the skipped failed row shows the real size instead of 0.
  const rawSize = extDoc.metadata?.fileSize ?? extDoc.metadata?.size
  const fileSize =
    typeof rawSize === 'number' && Number.isFinite(rawSize) ? Math.max(0, Math.trunc(rawSize)) : 0

  return {
    id: generateId(),
    knowledgeBaseId,
    filename: extDoc.title,
    fileUrl: '',
    storageKey: null,
    fileSize,
    mimeType: 'text/plain',
    processingStatus: 'failed',
    processingError: reason,
    enabled: true,
    connectorId,
    externalId: extDoc.externalId,
    contentHash: extDoc.contentHash,
    sourceUrl: extDoc.sourceUrl ?? null,
    ...tagValues,
    uploadedAt: new Date(),
  }
}

/**
 * Records source files that were intentionally not indexed as content-less `failed`
 * documents. New rows are inserted in bulk; authoritative skips replace stale rows.
 * This keeps the files visible in the knowledge base UI — with `processingError`
 * explaining why — instead of silently dropping them. The rows have no storage key,
 * so they are excluded from the stuck-document retry sweep (nothing to reprocess).
 *
 * Ordinary skips on previously indexed files remain last-known-good. A connector can
 * explicitly make a skip authoritative when retaining stale content would be wrong.
 *
 * Returns the number of rows recorded.
 */
export async function persistSkippedDocuments(
  knowledgeBaseId: string,
  connectorId: string,
  connectorType: string,
  skipOps: Array<{
    type: 'skip'
    existingId?: string
    extDoc: ExternalDocument
  }>,
  sourceConfig?: Record<string, unknown>
): Promise<number> {
  if (skipOps.length === 0) {
    return 0
  }
  const inserts = skipOps
    .filter((op) => !op.existingId)
    .map((op) =>
      buildSkippedDocumentRow(knowledgeBaseId, connectorId, connectorType, op.extDoc, sourceConfig)
    )
  const replacements = skipOps.filter((op): op is typeof op & { existingId: string } =>
    Boolean(op.existingId)
  )
  const replacedFileUrls: string[] = []

  await db.transaction(async (tx) => {
    const isActive = await isKnowledgeBaseActiveInTx(tx, knowledgeBaseId)
    if (!isActive) {
      throw new Error(`Knowledge base ${knowledgeBaseId} is deleted`)
    }

    if (inserts.length > 0) {
      await tx.insert(document).values(inserts)
    }

    for (const replacement of replacements) {
      const skipped = buildSkippedDocumentRow(
        knowledgeBaseId,
        connectorId,
        connectorType,
        replacement.extDoc,
        sourceConfig
      )
      const [current] = await tx
        .select({ fileUrl: document.fileUrl })
        .from(document)
        .where(connectorDocumentSyncTarget(replacement.existingId, knowledgeBaseId, connectorId))
        .for('update')
      if (!current) {
        throw new Error(`Document ${replacement.existingId} is no longer active`)
      }
      const tagValues = replacement.extDoc.metadata
        ? resolveTagMapping(connectorType, replacement.extDoc.metadata, sourceConfig)
        : undefined
      const replaced = await tx
        .update(document)
        .set({
          filename: skipped.filename,
          fileUrl: skipped.fileUrl,
          storageKey: skipped.storageKey,
          fileSize: skipped.fileSize,
          mimeType: skipped.mimeType,
          processingStatus: skipped.processingStatus,
          processingError: skipped.processingError,
          processingStartedAt: null,
          processingDeferredUntil: null,
          processingCompletedAt: new Date(),
          processingQueuedAt: null,
          processingQueueToken: null,
          processingAttempts: 0,
          chunkCount: 0,
          tokenCount: 0,
          characterCount: 0,
          contentHash: skipped.contentHash,
          sourceUrl: skipped.sourceUrl,
          uploadedAt: skipped.uploadedAt,
          deletedAt: null,
          ...tagValues,
        })
        .where(connectorDocumentSyncTarget(replacement.existingId, knowledgeBaseId, connectorId))
        .returning({ id: document.id })
      if (replaced.length === 0) {
        throw new Error(`Document ${replacement.existingId} is no longer active`)
      }
      if (current.fileUrl) replacedFileUrls.push(current.fileUrl)
      await tx.delete(embedding).where(eq(embedding.documentId, replacement.existingId))
    }
  })

  for (const fileUrl of replacedFileUrls) {
    try {
      const urlPath = new URL(fileUrl, 'http://localhost').pathname
      const storageKey = extractStorageKey(urlPath)
      if (storageKey && storageKey !== urlPath) {
        await deleteFile({ key: storageKey, context: 'knowledge-base' })
        await deleteFileMetadata(storageKey)
      }
    } catch (error) {
      logger.warn('Failed to delete storage for an authoritatively skipped document', {
        error: toError(error).message,
      })
    }
  }

  return skipOps.length
}

/**
 * Persists only connector-owned retry hashes for skipped refreshes of existing
 * documents. Indexed content and processing state stay last-known-good while the
 * hash guarantees that unchanged listing metadata still re-enters hydration.
 */
export async function persistSkippedRetryHashes(
  knowledgeBaseId: string,
  connectorId: string,
  updates: Array<{ existingId: string; externalId: string; contentHash: string }>
): Promise<string[]> {
  if (updates.length === 0) return []

  const missedExternalIds: string[] = []

  await db.transaction(async (tx) => {
    const isActive = await isKnowledgeBaseActiveInTx(tx, knowledgeBaseId)
    if (!isActive) {
      throw new Error(`Knowledge base ${knowledgeBaseId} is deleted`)
    }

    for (const update of updates) {
      const persisted = await tx
        .update(document)
        .set({ contentHash: update.contentHash })
        .where(connectorDocumentSyncTarget(update.existingId, knowledgeBaseId, connectorId))
        .returning({ id: document.id })
      if (persisted.length === 0) {
        missedExternalIds.push(update.externalId)
      }
    }
  })

  return missedExternalIds
}

/**
 * Upload content to storage as a .txt file, create a document record,
 * and trigger processing via the existing pipeline.
 */
export async function addDocument(
  knowledgeBaseId: string,
  connectorId: string,
  connectorType: string,
  extDoc: ExternalDocument,
  kbOwner: KnowledgeBaseOwner,
  sourceConfig?: Record<string, unknown>
): Promise<DocumentData> {
  const documentId = generateId()
  const artifact = connectorStoredArtifact(extDoc)
  const customKey = `kb/${buildStorageKeySegment(`${Date.now()}-${documentId}-`, artifact.fileName)}`

  const fileInfo = await StorageService.uploadFile({
    file: artifact.bytes,
    fileName: artifact.fileName,
    contentType: artifact.mimeType,
    context: 'knowledge-base',
    customKey,
    preserveKey: true,
    metadata: kbOwnershipMetadata(kbOwner, artifact.fileName),
  })

  const fileUrl = `${getInternalApiBaseUrl()}${fileInfo.path}?context=knowledge-base`

  const tagValues = extDoc.metadata
    ? resolveTagMapping(connectorType, extDoc.metadata, sourceConfig)
    : undefined

  try {
    await db.transaction(async (tx) => {
      const isActive = await isKnowledgeBaseActiveInTx(tx, knowledgeBaseId)
      if (!isActive) {
        throw new Error(`Knowledge base ${knowledgeBaseId} is deleted`)
      }

      await tx.insert(document).values({
        id: documentId,
        knowledgeBaseId,
        filename: extDoc.title,
        fileUrl,
        storageKey: fileInfo.key,
        fileSize: artifact.bytes.length,
        mimeType: artifact.mimeType,
        chunkCount: 0,
        tokenCount: 0,
        characterCount: 0,
        processingStatus: 'pending',
        enabled: true,
        connectorId,
        externalId: extDoc.externalId,
        contentHash: extDoc.contentHash,
        sourceUrl: extDoc.sourceUrl ?? null,
        ...tagValues,
        uploadedAt: new Date(),
      })
    })
  } catch (error) {
    const urlPath = new URL(fileUrl, 'http://localhost').pathname
    const storageKey = extractStorageKey(urlPath)
    if (storageKey && storageKey !== urlPath) {
      await deleteFile({ key: storageKey, context: 'knowledge-base' }).catch(() => undefined)
      await deleteFileMetadata(storageKey).catch(() => undefined)
    }
    throw error
  }

  return {
    documentId,
    filename: artifact.fileName,
    fileUrl,
    fileSize: artifact.bytes.length,
    mimeType: artifact.mimeType,
  }
}

/**
 * Update an existing connector-sourced document with new content.
 * Updates in-place to avoid unique constraint violations on (connectorId, externalId).
 */
export function connectorDocumentSyncTarget(
  documentId: string,
  knowledgeBaseId: string,
  connectorId: string
) {
  return and(
    eq(document.id, documentId),
    eq(document.knowledgeBaseId, knowledgeBaseId),
    eq(document.connectorId, connectorId),
    eq(document.userExcluded, false),
    isNull(document.archivedAt)
  )
}

export async function updateDocument(
  existingDocId: string,
  knowledgeBaseId: string,
  connectorId: string,
  connectorType: string,
  extDoc: ExternalDocument,
  kbOwner: KnowledgeBaseOwner,
  sourceConfig?: Record<string, unknown>
): Promise<DocumentData> {
  const existingRows = await db
    .select({ fileUrl: document.fileUrl })
    .from(document)
    .where(connectorDocumentSyncTarget(existingDocId, knowledgeBaseId, connectorId))
    .limit(1)
  const existingRow = existingRows[0]
  if (!existingRow) throw new Error(`Document ${existingDocId} is no longer active`)
  const oldFileUrl = existingRow.fileUrl

  const artifact = connectorStoredArtifact(extDoc)
  const customKey = `kb/${buildStorageKeySegment(`${Date.now()}-${existingDocId}-`, artifact.fileName)}`

  const fileInfo = await StorageService.uploadFile({
    file: artifact.bytes,
    fileName: artifact.fileName,
    contentType: artifact.mimeType,
    context: 'knowledge-base',
    customKey,
    preserveKey: true,
    metadata: kbOwnershipMetadata(kbOwner, artifact.fileName),
  })

  const fileUrl = `${getInternalApiBaseUrl()}${fileInfo.path}?context=knowledge-base`

  const tagValues = extDoc.metadata
    ? resolveTagMapping(connectorType, extDoc.metadata, sourceConfig)
    : undefined

  try {
    await db.transaction(async (tx) => {
      const isActive = await isKnowledgeBaseActiveInTx(tx, knowledgeBaseId)
      if (!isActive) {
        throw new Error(`Knowledge base ${knowledgeBaseId} is deleted`)
      }

      await tx
        .update(document)
        .set({
          filename: extDoc.title,
          fileUrl,
          storageKey: fileInfo.key,
          fileSize: artifact.bytes.length,
          // Re-stated on every update: a document first stored as connector-extracted
          // text and later re-synced as its source file has to stop declaring
          // `text/plain`, or the pipeline's OCR routing never sees it as a PDF.
          mimeType: artifact.mimeType,
          contentHash: extDoc.contentHash,
          sourceUrl: extDoc.sourceUrl ?? null,
          ...tagValues,
          processingStatus: 'pending',
          /** Prevents an older delayed worker from claiming newly stored content. */
          processingQueuedAt: null,
          processingQueueToken: null,
          processingDeferredUntil: null,
          /** A new document version starts with a fresh unattended-retry budget. */
          processingAttempts: 0,
          processingStartedAt: null,
          processingCompletedAt: null,
          processingError: null,
          uploadedAt: new Date(),
          // A tombstoned document reappearing with changed content is resurrected
          // in the same write as its content update — otherwise reconciliation's
          // separate resurrect step would clear deletedAt while this update, gated
          // on deletedAt IS NULL, rejects the row and leaves stale content active.
          deletedAt: null,
        })
        .where(connectorDocumentSyncTarget(existingDocId, knowledgeBaseId, connectorId))
        .returning({ id: document.id })
        .then((rows) => {
          if (rows.length === 0) {
            throw new Error(`Document ${existingDocId} is no longer active`)
          }
        })
    })
  } catch (error) {
    const urlPath = new URL(fileUrl, 'http://localhost').pathname
    const storageKey = extractStorageKey(urlPath)
    if (storageKey && storageKey !== urlPath) {
      await deleteFile({ key: storageKey, context: 'knowledge-base' }).catch(() => undefined)
      await deleteFileMetadata(storageKey).catch(() => undefined)
    }
    throw error
  }

  // Clean up old storage file and its ownership binding
  if (oldFileUrl) {
    try {
      const urlPath = new URL(oldFileUrl, 'http://localhost').pathname
      const storageKey = extractStorageKey(urlPath)
      if (storageKey && storageKey !== urlPath) {
        await deleteFile({ key: storageKey, context: 'knowledge-base' })
        await deleteFileMetadata(storageKey)
      }
    } catch (error) {
      logger.warn('Failed to delete old storage file', {
        documentId: existingDocId,
        error: toError(error).message,
      })
    }
  }

  return {
    documentId: existingDocId,
    filename: artifact.fileName,
    fileUrl,
    fileSize: artifact.bytes.length,
    mimeType: artifact.mimeType,
  }
}
