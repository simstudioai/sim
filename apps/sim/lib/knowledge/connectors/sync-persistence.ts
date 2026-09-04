import { db } from '@sim/db'
import { document, embedding, knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { chunkArray } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, exists, inArray, isNull, sql } from 'drizzle-orm'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import type { DbOrTx } from '@/lib/db/types'
import { textArrayLiteral } from '@/lib/knowledge/access/predicate'
import {
  EMPTY_ACL,
  MAX_ACL_TOKENS,
  validateAcl,
  WORKSPACE_ACL,
} from '@/lib/knowledge/access/tokens'
import { aclIsDerived, type ConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import { resolveSourceModifiedAt } from '@/lib/knowledge/connectors/source-modified-at'
import { assertSyncLeaseHeldInTx, type SyncWriteLease } from '@/lib/knowledge/connectors/sync-lock'
import type { DocumentData } from '@/lib/knowledge/documents/service'
import { StorageService } from '@/lib/uploads'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'
import { extractStorageKey } from '@/lib/uploads/utils/file-utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
import type { DocumentTags, ExternalDocument } from '@/connectors/types'

const logger = createLogger('ConnectorSyncPersistence')

function insertedDocumentAcl(access: ConnectorAccessMode): string[] {
  return [...(aclIsDerived(access) ? EMPTY_ACL : WORKSPACE_ACL)]
}

function updatedDocumentAcl(access: ConnectorAccessMode): { acl?: string[] } {
  return aclIsDerived(access) ? {} : { acl: [...WORKSPACE_ACL] }
}

/**
 * The workspace-mode invariant, applied after every successful content sync:
 * a document a workspace-mode connector owns is readable by the workspace,
 * whatever a mode switch or an interrupted rewrite left behind. Idempotent and
 * a no-op on a healthy connector.
 */
export async function restoreWorkspaceDocumentAcls(
  executor: DbOrTx,
  connectorId: string
): Promise<number> {
  const workspaceAcl = textArrayLiteral(WORKSPACE_ACL)
  const restored = await executor
    .update(document)
    .set({ acl: [...WORKSPACE_ACL] })
    .where(
      and(
        eq(document.connectorId, connectorId),
        sql`${document.acl} <> ${workspaceAcl}`,
        exists(
          executor
            .select({ one: sql`1` })
            .from(knowledgeConnector)
            .where(
              and(
                eq(knowledgeConnector.id, connectorId),
                eq(knowledgeConnector.accessMode, 'workspace')
              )
            )
        )
      )
    )
    .returning({ id: document.id })
  return restored.length
}

/**
 * Documents whose ACL is rewritten per statement. Documents are grouped by
 * identical ACL first — files under one folder overwhelmingly share theirs — so
 * a crawl of thousands usually resolves to a handful of statements.
 */
const ACL_WRITE_BATCH_SIZE = 500

export interface DocumentAclWriteResult {
  /** Documents whose stored ACL actually changed. */
  updated: number
  /** Documents whose ACL the source could not express; stored as readable by nobody. */
  rejected: number
}

/**
 * Writes the ACLs an admin-mode crawl mirrored from the source, and nothing
 * else.
 *
 * This deliberately does not go through the document update path. That path
 * sets `processingStatus: 'pending'`, which is the sole trigger of
 * re-embedding — and a permission change with no content change is the entire
 * point of mirroring ACLs, so routing it there would re-embed a corpus every
 * time somebody joined a group. Only `acl` is assigned here; `contentHash`,
 * `processingStatus`, `chunkCount` and the embedding rows are untouched.
 *
 * `IS DISTINCT FROM` keeps a re-run that changes nothing from writing anything,
 * so the pass is cheap to run often — which is what lets permissions sync on a
 * faster clock than content.
 *
 * An ACL the source expressed but we cannot store — malformed, or past
 * {@link MAX_ACL_TOKENS} — is stored as readable by nobody rather than skipped:
 * leaving the previous ACL in place would keep serving a document under
 * permissions we just failed to verify.
 */
export async function persistDocumentAcls(
  connectorId: string,
  acls: ReadonlyMap<string, readonly string[]>,
  executor: DbOrTx = db
): Promise<DocumentAclWriteResult> {
  const byAcl = new Map<string, { acl: string[]; externalIds: string[] }>()
  let rejected = 0

  for (const [externalId, tokens] of acls) {
    const validation = validateAcl(tokens)
    if (!validation.valid) {
      rejected += 1
      logger.error('Storing a connector document as readable by nobody: unusable ACL', {
        connectorId,
        externalId,
        reason: validation.reason,
        ...(validation.sample ? { sample: validation.sample } : {}),
        tokenCount: tokens.length,
      })
    }
    const acl = validation.valid ? validation.acl : [...EMPTY_ACL]
    const key = acl.join('\n')
    const group = byAcl.get(key)
    if (group) group.externalIds.push(externalId)
    else byAcl.set(key, { acl, externalIds: [externalId] })
  }

  let updated = 0
  for (const { acl, externalIds } of byAcl.values()) {
    for (const batch of chunkArray(externalIds, ACL_WRITE_BATCH_SIZE)) {
      const rows = await executor
        .update(document)
        .set({ acl })
        .where(
          and(
            eq(document.connectorId, connectorId),
            inArray(document.externalId, batch),
            sql`${document.acl} IS DISTINCT FROM ${textArrayLiteral(acl)}`
          )
        )
        .returning({ id: document.id })
      updated += rows.length
    }
  }

  return { updated, rejected }
}

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
  sourceConfig: Record<string, unknown> | undefined,
  access: ConnectorAccessMode
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
    sourceModifiedAt: resolveSourceModifiedAt(extDoc.metadata),
    acl: insertedDocumentAcl(access),
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
/** A document a sync wrote, by the id the source knows it by and the id the row has. */
export interface PersistedDocument {
  externalId: string
  documentId: string
}

export async function persistSkippedDocuments(
  knowledgeBaseId: string,
  connectorId: string,
  connectorType: string,
  skipOps: Array<{
    type: 'skip'
    existingId?: string
    extDoc: ExternalDocument
  }>,
  sourceConfig: Record<string, unknown> | undefined,
  access: ConnectorAccessMode,
  lease: SyncWriteLease
): Promise<PersistedDocument[]> {
  if (skipOps.length === 0) {
    return []
  }
  const inserts = skipOps
    .filter((op) => !op.existingId)
    .map((op) =>
      buildSkippedDocumentRow(
        knowledgeBaseId,
        connectorId,
        connectorType,
        op.extDoc,
        sourceConfig,
        access
      )
    )
  const persisted: PersistedDocument[] = [
    ...inserts.map((row) => ({ externalId: row.externalId, documentId: row.id })),
    ...skipOps
      .filter((op): op is typeof op & { existingId: string } => Boolean(op.existingId))
      .map((op) => ({ externalId: op.extDoc.externalId, documentId: op.existingId })),
  ]
  const replacements = skipOps.filter((op): op is typeof op & { existingId: string } =>
    Boolean(op.existingId)
  )
  const replacedFileUrls: string[] = []

  await db.transaction(async (tx) => {
    const isActive = await isKnowledgeBaseActiveInTx(tx, knowledgeBaseId)
    if (!isActive) {
      throw new Error(`Knowledge base ${knowledgeBaseId} is deleted`)
    }
    await assertSyncLeaseHeldInTx(tx, connectorId, lease)

    if (inserts.length > 0) {
      await tx.insert(document).values(inserts)
    }

    for (const replacement of replacements) {
      const skipped = buildSkippedDocumentRow(
        knowledgeBaseId,
        connectorId,
        connectorType,
        replacement.extDoc,
        sourceConfig,
        access
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
          sourceModifiedAt: skipped.sourceModifiedAt,
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
          ...updatedDocumentAcl(access),
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

  return persisted
}

/**
 * Persists only connector-owned retry hashes for skipped refreshes of existing
 * documents. Indexed content and processing state stay last-known-good while the
 * hash guarantees that unchanged listing metadata still re-enters hydration.
 */
export async function persistSkippedRetryHashes(
  knowledgeBaseId: string,
  connectorId: string,
  updates: Array<{ existingId: string; externalId: string; contentHash: string }>,
  lease: SyncWriteLease
): Promise<string[]> {
  if (updates.length === 0) return []

  const missedExternalIds: string[] = []

  await db.transaction(async (tx) => {
    const isActive = await isKnowledgeBaseActiveInTx(tx, knowledgeBaseId)
    if (!isActive) {
      throw new Error(`Knowledge base ${knowledgeBaseId} is deleted`)
    }
    await assertSyncLeaseHeldInTx(tx, connectorId, lease)

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
 * Stores the document's bytes (see {@link connectorStoredArtifact}) and inserts
 * its `pending` row; the caller dispatches processing.
 */
export async function addDocument(
  knowledgeBaseId: string,
  connectorId: string,
  connectorType: string,
  extDoc: ExternalDocument,
  kbOwner: KnowledgeBaseOwner,
  sourceConfig: Record<string, unknown> | undefined,
  access: ConnectorAccessMode,
  lease: SyncWriteLease
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
      await assertSyncLeaseHeldInTx(tx, connectorId, lease)

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
        sourceModifiedAt: resolveSourceModifiedAt(extDoc.metadata),
        acl: insertedDocumentAcl(access),
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

/** The row a connector-owned document write may target: live, connector-owned, and not user-excluded. */
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

/**
 * Update an existing connector-sourced document with new content.
 * Updates in-place to avoid unique constraint violations on (connectorId, externalId).
 */
export async function updateDocument(
  existingDocId: string,
  knowledgeBaseId: string,
  connectorId: string,
  connectorType: string,
  extDoc: ExternalDocument,
  kbOwner: KnowledgeBaseOwner,
  sourceConfig: Record<string, unknown> | undefined,
  access: ConnectorAccessMode,
  lease: SyncWriteLease
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
      await assertSyncLeaseHeldInTx(tx, connectorId, lease)

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
          sourceModifiedAt: resolveSourceModifiedAt(extDoc.metadata),
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
          ...updatedDocumentAcl(access),
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
