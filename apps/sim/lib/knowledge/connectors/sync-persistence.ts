import { db } from '@sim/db'
import { document, embedding, knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { and, eq, exists, inArray, isNull, sql } from 'drizzle-orm'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import type { DbOrTx } from '@/lib/db/types'
import { textArrayLiteral } from '@/lib/knowledge/access/predicate'
import {
  EMPTY_ACL,
  validateMirroredDocumentAcl,
  WORKSPACE_ACL,
} from '@/lib/knowledge/access/tokens'
import type { MirroredDocumentAcl } from '@/lib/knowledge/access/types'
import { aclIsDerived, type ConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import {
  claimConnectorUploadForAttachment,
  uploadConnectorArtifact,
} from '@/lib/knowledge/connectors/connector-upload'
import { resolveSourceModifiedAt } from '@/lib/knowledge/connectors/source-modified-at'
import { SOURCE_CONTENT_ERROR } from '@/lib/knowledge/connectors/sync-limits'
import { assertSyncLeaseHeldInTx, type SyncWriteLease } from '@/lib/knowledge/connectors/sync-lock'
import type { DocumentData } from '@/lib/knowledge/documents/service'
import { enqueueKnowledgeStorageCleanup } from '@/lib/knowledge/documents/storage-cleanup'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'
import { getFileMetadataByKeys } from '@/lib/uploads/server/metadata'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
import type { DocumentTags, ExternalDocument } from '@/connectors/types'

const logger = createLogger('ConnectorSyncPersistence')

function insertedDocumentAcl(access: ConnectorAccessMode): string[] {
  return [...(aclIsDerived(access) ? EMPTY_ACL : WORKSPACE_ACL)]
}

function updatedDocumentAcl(access: ConnectorAccessMode) {
  return aclIsDerived(access)
    ? {}
    : { acl: [...WORKSPACE_ACL], aclRequirements: [], aclVerifiedAt: null }
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
    .set({ acl: [...WORKSPACE_ACL], aclRequirements: [], aclVerifiedAt: null })
    .where(
      and(
        eq(document.connectorId, connectorId),
        sql`(${document.acl} <> ${workspaceAcl} OR ${document.aclRequirements} <> '[]'::jsonb OR ${document.aclVerifiedAt} IS NOT NULL)`,
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
  /** Documents whose ACL or authoritative evidence timestamp was refreshed. */
  updated: number
  /** Documents whose ACL the source could not express; stored as readable by nobody. */
  rejected: number
}

/**
 * Permission-only changes must not trigger re-embedding. Unchanged ACLs still refresh
 * their evidence timestamp; failed fetches cannot extend it. Malformed or oversized
 * ACLs are stored as unreadable so the previous grant cannot survive failed verification.
 */
export async function persistDocumentAcls(
  connectorId: string,
  acls: ReadonlyMap<string, MirroredDocumentAcl>,
  executor: DbOrTx = db
): Promise<DocumentAclWriteResult> {
  const byAcl = new Map<
    string,
    { acl: string[]; requirements: string[][]; externalIds: string[] }
  >()
  let rejected = 0
  const verifiedAt = new Date()

  for (const [externalId, value] of acls) {
    const validation = validateMirroredDocumentAcl(value)
    if (!validation.valid) {
      rejected += 1
      logger.error('Storing a connector document as readable by nobody: unusable ACL', {
        connectorId,
        externalId,
        reason: validation.reason,
      })
    }
    const acl = validation.valid ? validation.acl : [...EMPTY_ACL]
    /**
     * Keep the primary clause in the conjunctive snapshot too: an old writer
     * during rolling deployment knows only `acl` and must not erase the space
     * requirement while leaving this snapshot's verification time intact.
     */
    const requirements =
      validation.valid && validation.requirements.length > 0
        ? [acl, ...validation.requirements]
        : []
    const key = JSON.stringify([acl, requirements])
    const group = byAcl.get(key)
    if (group) group.externalIds.push(externalId)
    else byAcl.set(key, { acl, requirements, externalIds: [externalId] })
  }

  let updated = 0
  for (const { acl, requirements, externalIds } of byAcl.values()) {
    for (const batch of chunkArray(externalIds, ACL_WRITE_BATCH_SIZE)) {
      const rows = await executor
        .update(document)
        .set({
          acl,
          aclRequirements: requirements,
          aclVerifiedAt: acl.length > 0 ? verifiedAt : null,
        })
        .where(and(eq(document.connectorId, connectorId), inArray(document.externalId, batch)))
        .returning({ id: document.id })
      updated += rows.length
    }
  }

  return { updated, rejected }
}

const MAX_SAFE_TITLE_LENGTH = 200

function sanitizeStorageTitle(title: string): string {
  return title.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, MAX_SAFE_TITLE_LENGTH)
}

/** Preserve the extension when truncating: parser selection reads the storage key. */
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

/** Source files retain their parser format; connector-extracted text must use .txt. */
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

/** Canonical owning scope and uploader attribution, resolved once per sync. */
export interface KnowledgeBaseOwner {
  workspaceId: string | null
  organizationId?: string | null
  userId: string
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
  return {
    id: generateId(),
    knowledgeBaseId,
    filename: extDoc.title,
    fileUrl: '',
    storageKey: null,
    /** No artifact was stored; a provider's reported source size is not local storage usage. */
    fileSize: 0,
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
        .select({
          fileUrl: document.fileUrl,
          workspaceId: knowledgeBase.workspaceId,
          organizationId: knowledgeBase.organizationId,
          userId: sql<string>`COALESCE(${document.uploadedBy}, ${knowledgeBase.userId})`,
        })
        .from(document)
        .innerJoin(knowledgeBase, eq(document.knowledgeBaseId, knowledgeBase.id))
        .where(connectorDocumentSyncTarget(replacement.existingId, knowledgeBaseId, connectorId))
        .for('update', { of: document })
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
      await enqueueKnowledgeStorageCleanup(
        tx,
        [{ id: replacement.existingId, ...current }],
        replacement.existingId
      )
      await tx.delete(embedding).where(eq(embedding.documentId, replacement.existingId))
    }
  })

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

/** Records a failed source refresh without discarding prior bytes; null hash guarantees a later source retry. */
export async function persistSourceDocumentFailures(input: {
  knowledgeBaseId: string
  connectorId: string
  connectorType: string
  documents: readonly ExternalDocument[]
  failedExternalIds: ReadonlySet<string>
  priorByExternalId: ReadonlyMap<string, { id: string }>
  sourceConfig: Record<string, unknown>
  access: ConnectorAccessMode
  lease: SyncWriteLease
}): Promise<void> {
  const failed = [
    ...new Map(
      input.documents
        .filter((item) => input.failedExternalIds.has(item.externalId))
        .map((item) => [item.externalId, item])
    ).values(),
  ]
  if (failed.length === 0) return
  await db.transaction(async (tx) => {
    if (!(await isKnowledgeBaseActiveInTx(tx, input.knowledgeBaseId)))
      throw new Error('Knowledge base was deleted')
    await assertSyncLeaseHeldInTx(tx, input.connectorId, input.lease)
    const existingIds = failed.flatMap((item) => {
      const existing = input.priorByExternalId.get(item.externalId)
      return existing ? [existing.id] : []
    })
    for (let offset = 0; offset < existingIds.length; offset += 500) {
      await tx
        .update(document)
        .set({
          contentHash: null,
          processingStatus: 'failed',
          processingError: SOURCE_CONTENT_ERROR,
          processingQueuedAt: null,
          processingQueueToken: null,
          processingDeferredUntil: null,
          processingCompletedAt: new Date(),
        })
        .where(
          and(
            eq(document.connectorId, input.connectorId),
            eq(document.knowledgeBaseId, input.knowledgeBaseId),
            inArray(document.id, existingIds.slice(offset, offset + 500)),
            eq(document.userExcluded, false),
            isNull(document.archivedAt)
          )
        )
    }
    const newItems = failed.filter((item) => !input.priorByExternalId.has(item.externalId))
    for (let offset = 0; offset < newItems.length; offset += 500) {
      await tx.insert(document).values(
        newItems.slice(offset, offset + 500).map((item) => ({
          ...buildSkippedDocumentRow(
            input.knowledgeBaseId,
            input.connectorId,
            input.connectorType,
            { ...item, skippedReason: SOURCE_CONTENT_ERROR },
            input.sourceConfig,
            input.access
          ),
          contentHash: null,
          processingCompletedAt: new Date(),
        }))
      )
    }
  })
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

  const fileInfo = await uploadConnectorArtifact({
    documentId,
    key: customKey,
    owner: kbOwner,
    artifact,
  })

  const fileUrl = `${getInternalApiBaseUrl()}${fileInfo.path}?context=knowledge-base`

  const tagValues = extDoc.metadata
    ? resolveTagMapping(connectorType, extDoc.metadata, sourceConfig)
    : undefined
  await db.transaction(async (tx) => {
    await claimConnectorUploadForAttachment(tx, fileInfo.cleanupEventId)
    const isActive = await isKnowledgeBaseActiveInTx(tx, knowledgeBaseId)
    if (!isActive) {
      throw new Error(`Knowledge base ${knowledgeBaseId} is deleted`)
    }
    await assertSyncLeaseHeldInTx(tx, connectorId, lease)
    const [uploadedBinding] = await getFileMetadataByKeys([fileInfo.key], 'knowledge-base', tx, {
      lock: 'share',
    })
    if (
      !uploadedBinding ||
      uploadedBinding.id !== fileInfo.metadataId ||
      uploadedBinding.contentUpdatedAt.getTime() !== fileInfo.contentUpdatedAt.getTime()
    )
      throw new Error('Connector upload expired before it could be attached')

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

  const artifact = connectorStoredArtifact(extDoc)
  const customKey = `kb/${buildStorageKeySegment(`${Date.now()}-${generateId()}-`, artifact.fileName)}`

  const fileInfo = await uploadConnectorArtifact({
    documentId: existingDocId,
    key: customKey,
    owner: kbOwner,
    artifact,
  })

  const fileUrl = `${getInternalApiBaseUrl()}${fileInfo.path}?context=knowledge-base`

  const tagValues = extDoc.metadata
    ? resolveTagMapping(connectorType, extDoc.metadata, sourceConfig)
    : undefined
  await db.transaction(async (tx) => {
    await claimConnectorUploadForAttachment(tx, fileInfo.cleanupEventId)
    const isActive = await isKnowledgeBaseActiveInTx(tx, knowledgeBaseId)
    if (!isActive) {
      throw new Error(`Knowledge base ${knowledgeBaseId} is deleted`)
    }
    await assertSyncLeaseHeldInTx(tx, connectorId, lease)
    const [uploadedBinding] = await getFileMetadataByKeys([fileInfo.key], 'knowledge-base', tx, {
      lock: 'share',
    })
    if (
      !uploadedBinding ||
      uploadedBinding.id !== fileInfo.metadataId ||
      uploadedBinding.contentUpdatedAt.getTime() !== fileInfo.contentUpdatedAt.getTime()
    )
      throw new Error('Connector upload expired before it could be attached')
    const [previous] = await tx
      .select({ fileUrl: document.fileUrl })
      .from(document)
      .where(connectorDocumentSyncTarget(existingDocId, knowledgeBaseId, connectorId))
      .for('update')
      .limit(1)
    if (!previous) throw new Error(`Document ${existingDocId} is no longer active`)
    await enqueueKnowledgeStorageCleanup(
      tx,
      [{ id: existingDocId, fileUrl: previous.fileUrl, ...kbOwner }],
      existingDocId
    )

    await tx
      .update(document)
      .set({
        filename: extDoc.title,
        fileUrl,
        storageKey: fileInfo.key,
        fileSize: artifact.bytes.length,
        /**
         * Re-stated on every update: a document first stored as connector-extracted
         * text and later re-synced as its source file has to stop declaring
         * `text/plain`, or the pipeline's OCR routing never sees it as a PDF.
         */
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
        /**
         * A tombstoned document reappearing with changed content is resurrected
         * in the same write as its content update — otherwise reconciliation's
         * separate resurrect step would clear deletedAt while this update, gated
         * on deletedAt IS NULL, rejects the row and leaves stale content active.
         */
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

  return {
    documentId: existingDocId,
    filename: artifact.fileName,
    fileUrl,
    fileSize: artifact.bytes.length,
    mimeType: artifact.mimeType,
  }
}
