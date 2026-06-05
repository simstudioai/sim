import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorSyncLog,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { randomInt } from '@sim/utils/random'
import { and, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { decryptApiKey } from '@/lib/api-key/crypto'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import type { DocumentData } from '@/lib/knowledge/documents/service'
import {
  hardDeleteDocuments,
  isTriggerAvailable,
  processDocumentsWithQueue,
} from '@/lib/knowledge/documents/service'
import { StorageService } from '@/lib/uploads'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'
import { extractStorageKey } from '@/lib/uploads/utils/file-utils'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { knowledgeConnectorSync } from '@/background/knowledge-connector-sync'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'
import type {
  ConnectorAuthConfig,
  DocumentTags,
  ExternalDocument,
  SyncResult,
} from '@/connectors/types'

const logger = createLogger('ConnectorSyncEngine')

class ConnectorDeletedException extends Error {
  constructor(connectorId: string) {
    super(`Connector ${connectorId} was deleted during sync`)
    this.name = 'ConnectorDeletedException'
  }
}

const SYNC_BATCH_SIZE = 5
const MAX_PAGES = 500
const MAX_SAFE_TITLE_LENGTH = 200
const STALE_PROCESSING_MINUTES = 45
const RETRY_WINDOW_DAYS = 7
const MAX_CONSECUTIVE_FAILURES = 10

/** Sanitizes a document title for use in S3 storage keys. */
function sanitizeStorageTitle(title: string): string {
  return title.replace(/[^a-zA-Z0-9.-]/g, '_').slice(0, MAX_SAFE_TITLE_LENGTH)
}
type KnowledgeBaseLockingTx = Pick<typeof db, 'execute' | 'select'>

type DocOp =
  | { type: 'add'; extDoc: ExternalDocument }
  | { type: 'update'; existingId: string; extDoc: ExternalDocument }

/** Single-roundtrip liveness check used between batches. */
async function checkSyncLiveness(
  connectorId: string,
  knowledgeBaseId: string
): Promise<{ connectorDeleted: boolean; knowledgeBaseDeleted: boolean }> {
  const rows = await db
    .select({
      connectorArchivedAt: knowledgeConnector.archivedAt,
      connectorDeletedAt: knowledgeConnector.deletedAt,
      kbDeletedAt: knowledgeBase.deletedAt,
    })
    .from(knowledgeConnector)
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .where(and(eq(knowledgeConnector.id, connectorId), eq(knowledgeBase.id, knowledgeBaseId)))
    .limit(1)

  if (rows.length === 0) {
    return { connectorDeleted: true, knowledgeBaseDeleted: true }
  }
  const row = rows[0]
  return {
    connectorDeleted: row.connectorArchivedAt !== null || row.connectorDeletedAt !== null,
    knowledgeBaseDeleted: row.kbDeletedAt !== null,
  }
}

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

function calculateNextSyncTime(syncIntervalMinutes: number): Date | null {
  if (syncIntervalMinutes <= 0) return null
  const now = Date.now()
  const jitterMs = randomInt(0, Math.min(syncIntervalMinutes * 6_000, 300_000))
  return new Date(now + syncIntervalMinutes * 60_000 + jitterMs)
}

async function completeSyncLog(
  syncLogId: string,
  status: 'completed' | 'failed',
  result: SyncResult,
  errorMessage?: string
): Promise<void> {
  await db
    .update(knowledgeConnectorSyncLog)
    .set({
      status,
      completedAt: new Date(),
      ...(errorMessage != null && { errorMessage }),
      docsAdded: result.docsAdded,
      docsUpdated: result.docsUpdated,
      docsDeleted: result.docsDeleted,
      docsUnchanged: result.docsUnchanged,
      docsFailed: result.docsFailed,
    })
    .where(eq(knowledgeConnectorSyncLog.id, syncLogId))
}

/**
 * Decides whether deletion reconciliation may run for a sync.
 *
 * Reconciliation hard-deletes every stored document absent from the listing,
 * so it must only run against a complete source set:
 * - never on incremental syncs (they list only changed documents)
 * - never when the engine truncated pagination (`listingTruncated`) — a forced
 *   fullSync cannot fix truncation, so it cannot override it
 * - not when a connector capped its listing (`listingCapped`), unless a forced
 *   fullSync deliberately overrides the cap to reconcile the capped scope
 */
export function shouldReconcileDeletions(
  isIncremental: boolean | undefined,
  syncContext: Record<string, unknown> | undefined,
  fullSync: boolean | undefined
): boolean {
  if (isIncremental) return false
  if (syncContext?.listingTruncated) return false
  return !syncContext?.listingCapped || Boolean(fullSync)
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

/**
 * Dispatch a connector sync using the configured background execution backend.
 */
export async function dispatchSync(
  connectorId: string,
  options?: { fullSync?: boolean; requestId?: string }
): Promise<void> {
  const requestId = options?.requestId ?? generateId()

  if (isTriggerAvailable()) {
    const connectorRows = await db
      .select({
        knowledgeBaseId: knowledgeConnector.knowledgeBaseId,
        connectorArchivedAt: knowledgeConnector.archivedAt,
        connectorDeletedAt: knowledgeConnector.deletedAt,
        workspaceId: knowledgeBase.workspaceId,
        userId: knowledgeBase.userId,
        kbDeletedAt: knowledgeBase.deletedAt,
      })
      .from(knowledgeConnector)
      .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
      .where(eq(knowledgeConnector.id, connectorId))
      .limit(1)

    const row = connectorRows[0]
    if (!row) {
      logger.warn(`Skipping sync dispatch: connector not found`, { connectorId, requestId })
      return
    }
    if (row.kbDeletedAt) {
      logger.warn(`Skipping sync dispatch: knowledge base is deleted`, {
        connectorId,
        knowledgeBaseId: row.knowledgeBaseId,
        requestId,
      })
      await db
        .update(knowledgeConnector)
        .set({
          status: 'error',
          nextSyncAt: null,
          lastSyncError: 'Knowledge base deleted',
          updatedAt: new Date(),
        })
        .where(eq(knowledgeConnector.id, connectorId))
      return
    }
    if (row.connectorArchivedAt || row.connectorDeletedAt) {
      logger.warn(`Skipping sync dispatch: connector is archived or deleted`, {
        connectorId,
        requestId,
      })
      return
    }

    const tags = [`connectorId:${connectorId}`]
    if (row.knowledgeBaseId) tags.push(`knowledgeBaseId:${row.knowledgeBaseId}`)
    if (row.workspaceId) tags.push(`workspaceId:${row.workspaceId}`)
    if (row.userId) tags.push(`userId:${row.userId}`)

    await knowledgeConnectorSync.trigger(
      {
        connectorId,
        fullSync: options?.fullSync,
        requestId,
      },
      { tags }
    )
    logger.info(`Dispatched connector sync to Trigger.dev`, { connectorId, requestId })
  } else {
    executeSync(connectorId, { fullSync: options?.fullSync }).catch((error) => {
      logger.error(`Sync failed for connector ${connectorId}`, {
        error: toError(error).message,
        requestId,
      })
    })
  }
}

/**
 * Resolves an access token for a connector based on its auth mode.
 * OAuth connectors refresh via the credential system; API key connectors
 * decrypt the key stored in the dedicated `encryptedApiKey` column.
 */
async function resolveAccessToken(
  connector: { credentialId: string | null; encryptedApiKey: string | null },
  connectorConfig: { auth: ConnectorAuthConfig },
  userId: string
): Promise<string> {
  if (connectorConfig.auth.mode === 'apiKey') {
    if (!connector.encryptedApiKey) {
      throw new Error('API key connector is missing encrypted API key')
    }
    const { decrypted } = await decryptApiKey(connector.encryptedApiKey)
    return decrypted
  }

  if (!connector.credentialId) {
    throw new Error('OAuth connector is missing credential ID')
  }

  const requestId = `sync-${connector.credentialId}`
  const token = await refreshAccessTokenIfNeeded(connector.credentialId, userId, requestId)

  if (!token) {
    logger.error(`[${requestId}] refreshAccessTokenIfNeeded returned null`, {
      credentialId: connector.credentialId,
      userId,
      authMode: connectorConfig.auth.mode,
      authProvider: connectorConfig.auth.provider,
    })
    throw new Error(
      `Failed to obtain access token for credential ${connector.credentialId} (provider: ${connectorConfig.auth.provider})`
    )
  }

  return token
}

/**
 * Execute a sync for a given knowledge connector.
 *
 * This is the core sync algorithm — connector-agnostic.
 * It looks up the ConnectorConfig from the registry and calls its
 * listDocuments/getDocument methods.
 */
export async function executeSync(
  connectorId: string,
  options?: { fullSync?: boolean }
): Promise<SyncResult> {
  const result: SyncResult = {
    docsAdded: 0,
    docsUpdated: 0,
    docsDeleted: 0,
    docsUnchanged: 0,
    docsFailed: 0,
  }

  const connectorRows = await db
    .select()
    .from(knowledgeConnector)
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
    .limit(1)

  if (connectorRows.length === 0) {
    logger.warn(`Skipping sync: connector ${connectorId} not found, archived, or deleted`)
    return { ...result, error: 'connector_unavailable' }
  }

  const connector = connectorRows[0]

  const connectorConfig = CONNECTOR_REGISTRY[connector.connectorType]
  if (!connectorConfig) {
    throw new Error(`Unknown connector type: ${connector.connectorType}`)
  }

  const kbRows = await db
    .select({ userId: knowledgeBase.userId, workspaceId: knowledgeBase.workspaceId })
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.id, connector.knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
    .limit(1)

  if (kbRows.length === 0) {
    logger.warn(
      `Skipping sync: knowledge base ${connector.knowledgeBaseId} is deleted (connector ${connectorId})`
    )
    await db
      .update(knowledgeConnector)
      .set({
        status: 'error',
        nextSyncAt: null,
        lastSyncError: 'Knowledge base deleted',
        updatedAt: new Date(),
      })
      .where(eq(knowledgeConnector.id, connectorId))
    return { ...result, error: 'knowledge_base_deleted' }
  }

  const userId = kbRows[0].userId
  // Resolved once per sync and threaded into add/updateDocument so every synced
  // kb/ object records a trusted ownership binding without an N+1 KB lookup.
  const kbOwner: KnowledgeBaseOwner = { workspaceId: kbRows[0].workspaceId, userId }
  const sourceConfig = connector.sourceConfig as Record<string, unknown>

  const lockResult = await db
    .update(knowledgeConnector)
    .set({ status: 'syncing', updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        ne(knowledgeConnector.status, 'syncing'),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
    .returning({ id: knowledgeConnector.id })

  if (lockResult.length === 0) {
    logger.info('Sync already in progress, skipping', { connectorId })
    return result
  }

  const syncLogId = generateId()
  const syncStartedAt = new Date()
  await db.insert(knowledgeConnectorSyncLog).values({
    id: syncLogId,
    connectorId,
    status: 'started',
    startedAt: syncStartedAt,
  })

  let syncExitedCleanly = false

  try {
    let accessToken = await resolveAccessToken(connector, connectorConfig, userId)

    const externalDocs: ExternalDocument[] = []
    let cursor: string | undefined
    let hasMore = true
    const syncContext: Record<string, unknown> = { syncRunId: generateId() }

    // Determine if this sync should be incremental
    const isIncremental =
      connectorConfig.supportsIncrementalSync &&
      connector.syncMode !== 'full' &&
      !options?.fullSync &&
      connector.lastSyncAt != null
    const lastSyncAt =
      isIncremental && connector.lastSyncAt ? new Date(connector.lastSyncAt) : undefined

    for (let pageNum = 0; hasMore && pageNum < MAX_PAGES; pageNum++) {
      if (pageNum > 0 && connectorConfig.auth.mode === 'oauth') {
        accessToken = await resolveAccessToken(connector, connectorConfig, userId)
      }

      const page = await connectorConfig.listDocuments(
        accessToken,
        sourceConfig,
        cursor,
        syncContext,
        lastSyncAt
      )
      externalDocs.push(...page.documents)

      if (page.hasMore && !page.nextCursor) {
        logger.warn('Source returned hasMore=true with no cursor, stopping pagination', {
          connectorId,
          pageNum,
          docsSoFar: externalDocs.length,
        })
        break
      }

      cursor = page.nextCursor
      hasMore = page.hasMore
    }

    if (hasMore) {
      /**
       * Pagination stopped before source exhaustion (MAX_PAGES or a missing
       * cursor), so the listing is incomplete. `listingTruncated` blocks
       * deletion reconciliation absolutely — unlike connector-set
       * `listingCapped`, it cannot be overridden by a forced fullSync, since
       * re-running one truncates identically.
       */
      syncContext.listingCapped = true
      syncContext.listingTruncated = true
      logger.warn('Pagination ended before source exhaustion; skipping deletion reconciliation', {
        connectorId,
        docsSoFar: externalDocs.length,
      })
    }

    logger.info(`Fetched ${externalDocs.length} documents from ${connectorConfig.name}`, {
      connectorId,
    })

    const [existingDocs, excludedDocs] = await Promise.all([
      db
        .select({
          id: document.id,
          externalId: document.externalId,
          contentHash: document.contentHash,
        })
        .from(document)
        .where(
          and(
            eq(document.connectorId, connectorId),
            isNull(document.archivedAt),
            isNull(document.deletedAt)
          )
        ),
      db
        .select({ externalId: document.externalId })
        .from(document)
        .where(
          and(
            eq(document.connectorId, connectorId),
            eq(document.userExcluded, true),
            isNull(document.archivedAt),
            isNull(document.deletedAt)
          )
        ),
    ])

    const excludedExternalIds = new Set(excludedDocs.map((d) => d.externalId).filter(Boolean))

    if (externalDocs.length === 0 && existingDocs.length > 0 && !options?.fullSync) {
      logger.warn(
        `Source returned 0 documents but ${existingDocs.length} exist — skipping reconciliation`,
        { connectorId }
      )

      await completeSyncLog(syncLogId, 'completed', result)

      const now = new Date()
      await db
        .update(knowledgeConnector)
        .set({
          status: 'active',
          lastSyncAt: now,
          lastSyncError: null,
          nextSyncAt: calculateNextSyncTime(connector.syncIntervalMinutes),
          consecutiveFailures: 0,
          updatedAt: now,
        })
        .where(
          and(
            eq(knowledgeConnector.id, connectorId),
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )

      return result
    }

    const existingByExternalId = new Map(
      existingDocs.filter((d) => d.externalId !== null).map((d) => [d.externalId!, d])
    )

    const seenExternalIds = new Set<string>()

    const pendingOps: DocOp[] = []
    for (const extDoc of externalDocs) {
      if (seenExternalIds.has(extDoc.externalId)) continue
      seenExternalIds.add(extDoc.externalId)

      if (excludedExternalIds.has(extDoc.externalId)) {
        result.docsUnchanged++
        continue
      }

      if (!extDoc.content.trim() && !extDoc.contentDeferred) {
        logger.info(`Skipping empty document: ${extDoc.title}`, {
          externalId: extDoc.externalId,
        })
        continue
      }

      const existing = existingByExternalId.get(extDoc.externalId)

      if (!existing) {
        pendingOps.push({ type: 'add', extDoc })
      } else if (existing.contentHash !== extDoc.contentHash) {
        pendingOps.push({ type: 'update', existingId: existing.id, extDoc })
      } else {
        result.docsUnchanged++
      }
    }

    for (let i = 0; i < pendingOps.length; i += SYNC_BATCH_SIZE) {
      const liveness = await checkSyncLiveness(connectorId, connector.knowledgeBaseId)
      if (liveness.connectorDeleted) {
        throw new ConnectorDeletedException(connectorId)
      }
      if (liveness.knowledgeBaseDeleted) {
        throw new Error(`Knowledge base ${connector.knowledgeBaseId} was deleted during sync`)
      }

      const rawBatch = pendingOps.slice(i, i + SYNC_BATCH_SIZE)

      const deferredOps = rawBatch.filter((op) => op.extDoc.contentDeferred)
      const readyOps = rawBatch.filter((op) => !op.extDoc.contentDeferred)

      if (deferredOps.length > 0) {
        if (connectorConfig.auth.mode === 'oauth') {
          accessToken = await resolveAccessToken(connector, connectorConfig, userId)
        }

        const hydrated = await Promise.allSettled(
          deferredOps.map(async (op) => {
            const fullDoc = await connectorConfig.getDocument(
              accessToken!,
              sourceConfig,
              op.extDoc.externalId,
              syncContext
            )
            if (!fullDoc?.content.trim()) return null
            const hydratedHash = fullDoc.contentHash ?? op.extDoc.contentHash
            if (
              op.type === 'update' &&
              existingByExternalId.get(op.extDoc.externalId)?.contentHash === hydratedHash
            ) {
              result.docsUnchanged++
              return null
            }
            return {
              ...op,
              extDoc: {
                ...op.extDoc,
                title: fullDoc.title || op.extDoc.title,
                content: fullDoc.content,
                contentHash: hydratedHash,
                contentDeferred: false,
                sourceUrl: fullDoc.sourceUrl ?? op.extDoc.sourceUrl,
                metadata: { ...op.extDoc.metadata, ...fullDoc.metadata },
              },
            }
          })
        )

        for (const outcome of hydrated) {
          if (outcome.status === 'fulfilled' && outcome.value) {
            readyOps.push(outcome.value)
          } else if (outcome.status === 'rejected') {
            result.docsFailed++
            logger.error('Failed to hydrate deferred document', {
              connectorId,
              error:
                outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
            })
          }
        }
      }

      const batch = readyOps

      const settled = await Promise.allSettled(
        batch.map((op) => {
          if (op.type === 'add') {
            return addDocument(
              connector.knowledgeBaseId,
              connectorId,
              connector.connectorType,
              op.extDoc,
              kbOwner,
              sourceConfig
            )
          }
          return updateDocument(
            op.existingId,
            connector.knowledgeBaseId,
            connectorId,
            connector.connectorType,
            op.extDoc,
            kbOwner,
            sourceConfig
          )
        })
      )

      const batchDocs: DocumentData[] = []
      for (let j = 0; j < settled.length; j++) {
        const outcome = settled[j]
        if (outcome.status === 'fulfilled') {
          batchDocs.push(outcome.value)
          if (batch[j].type === 'add') result.docsAdded++
          else result.docsUpdated++
        } else {
          result.docsFailed++
          logger.error('Failed to process document', {
            connectorId,
            externalId: batch[j].extDoc.externalId,
            error:
              outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
          })
        }
      }

      if (batchDocs.length > 0) {
        try {
          await processDocumentsWithQueue(batchDocs, connector.knowledgeBaseId, {}, generateId())
        } catch (error) {
          logger.warn('Failed to enqueue batch for processing — will retry on next sync', {
            connectorId,
            count: batchDocs.length,
            error: toError(error).message,
          })
        }
      }
    }

    if (shouldReconcileDeletions(isIncremental, syncContext, options?.fullSync)) {
      const removedIds = existingDocs
        .filter((d) => d.externalId && !seenExternalIds.has(d.externalId))
        .map((d) => d.id)

      if (removedIds.length > 0) {
        const deletionRatio = existingDocs.length > 0 ? removedIds.length / existingDocs.length : 0

        if (deletionRatio > 0.5 && removedIds.length > 5 && !options?.fullSync) {
          logger.warn(
            `Skipping deletion of ${removedIds.length}/${existingDocs.length} docs — exceeds safety threshold. Trigger a full sync to force cleanup.`,
            { connectorId, deletionRatio: Math.round(deletionRatio * 100) }
          )
        } else {
          await hardDeleteDocuments(removedIds, syncLogId)
          result.docsDeleted += removedIds.length
        }
      }
    }

    // Check if connector/KB were deleted before retrying stuck documents
    const postBatchLiveness = await checkSyncLiveness(connectorId, connector.knowledgeBaseId)
    if (postBatchLiveness.connectorDeleted) {
      throw new ConnectorDeletedException(connectorId)
    }
    if (postBatchLiveness.knowledgeBaseDeleted) {
      throw new Error(`Knowledge base ${connector.knowledgeBaseId} was deleted during sync`)
    }

    // Retry stuck documents that failed, never started, or were abandoned mid-processing.
    // Only retry docs uploaded BEFORE this sync — docs added in the current sync
    // are still processing asynchronously and would cause a duplicate processing race.
    // Documents stuck in 'processing' beyond STALE_PROCESSING_MINUTES are considered
    // abandoned (e.g. the Trigger.dev task process exited before processing completed).
    // Documents uploaded more than RETRY_WINDOW_DAYS ago are not retried.
    const staleProcessingCutoff = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000)
    const retryCutoff = new Date(Date.now() - RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const stuckDocs = await db
      .select({
        id: document.id,
        fileUrl: document.fileUrl,
        filename: document.filename,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
      })
      .from(document)
      .where(
        and(
          eq(document.connectorId, connectorId),
          or(
            inArray(document.processingStatus, ['pending', 'failed']),
            and(
              eq(document.processingStatus, 'processing'),
              or(
                isNull(document.processingStartedAt),
                lt(document.processingStartedAt, staleProcessingCutoff)
              )
            )
          ),
          lt(document.uploadedAt, syncStartedAt),
          gt(document.uploadedAt, retryCutoff),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )

    if (stuckDocs.length > 0) {
      logger.info(`Retrying ${stuckDocs.length} stuck documents`, { connectorId })
      try {
        const stuckDocIds = stuckDocs.map((doc) => doc.id)

        await db.delete(embedding).where(inArray(embedding.documentId, stuckDocIds))

        await db
          .update(document)
          .set({
            processingStatus: 'pending',
            processingStartedAt: null,
            processingCompletedAt: null,
            processingError: null,
            chunkCount: 0,
            tokenCount: 0,
            characterCount: 0,
          })
          .where(inArray(document.id, stuckDocIds))

        await processDocumentsWithQueue(
          stuckDocs.map((doc) => ({
            documentId: doc.id,
            filename: doc.filename ?? 'document.txt',
            fileUrl: doc.fileUrl ?? '',
            fileSize: doc.fileSize ?? 0,
            mimeType: doc.mimeType ?? 'text/plain',
          })),
          connector.knowledgeBaseId,
          {},
          generateId()
        )
      } catch (error) {
        logger.warn('Failed to enqueue stuck documents for reprocessing', {
          connectorId,
          count: stuckDocs.length,
          error: toError(error).message,
        })
      }
    }

    await completeSyncLog(syncLogId, 'completed', result)

    const [{ count: actualDocCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(document)
      .where(
        and(
          eq(document.connectorId, connectorId),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )

    const now = new Date()
    await db
      .update(knowledgeConnector)
      .set({
        status: 'active',
        lastSyncAt: now,
        lastSyncError: null,
        lastSyncDocCount: actualDocCount,
        nextSyncAt: calculateNextSyncTime(connector.syncIntervalMinutes),
        consecutiveFailures: 0,
        updatedAt: now,
      })
      .where(
        and(
          eq(knowledgeConnector.id, connectorId),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )

    logger.info('Sync completed', { connectorId, ...result })
    syncExitedCleanly = true
    return result
  } catch (error) {
    if (error instanceof ConnectorDeletedException) {
      logger.info('Connector deleted during sync, cleaning up', { connectorId })

      try {
        const connectorDocs = await db
          .select({ id: document.id })
          .from(document)
          .where(
            and(
              eq(document.connectorId, connectorId),
              isNull(document.archivedAt),
              isNull(document.deletedAt)
            )
          )

        await hardDeleteDocuments(
          connectorDocs.map((doc) => doc.id),
          syncLogId
        )

        await completeSyncLog(syncLogId, 'failed', result, 'Connector deleted during sync')
      } catch (cleanupError) {
        logger.error('Failed to clean up after connector deletion', {
          connectorId,
          error: toError(cleanupError).message,
        })
      }

      result.error = 'Connector deleted during sync'
      syncExitedCleanly = true
      return result
    }

    const errorMessage = toError(error).message
    logger.error('Sync failed', { connectorId, error: errorMessage })

    try {
      await completeSyncLog(syncLogId, 'failed', result, errorMessage)

      const now = new Date()
      const failures = (connector.consecutiveFailures ?? 0) + 1
      const disabled = failures >= MAX_CONSECUTIVE_FAILURES
      const backoffMinutes = Math.min(failures * 30, 1440)
      const nextSync = disabled ? null : new Date(now.getTime() + backoffMinutes * 60 * 1000)

      if (disabled) {
        logger.warn('Connector disabled after repeated failures', {
          connectorId,
          consecutiveFailures: failures,
        })
      }

      await db
        .update(knowledgeConnector)
        .set({
          status: disabled ? 'disabled' : 'error',
          lastSyncAt: now,
          lastSyncError: disabled
            ? 'Connector disabled after repeated sync failures. Please reconnect.'
            : errorMessage,
          nextSyncAt: nextSync,
          consecutiveFailures: failures,
          updatedAt: now,
        })
        .where(
          and(
            eq(knowledgeConnector.id, connectorId),
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )
    } catch (recoveryError) {
      logger.error('Failed to record sync failure', {
        connectorId,
        error: toError(recoveryError).message,
      })
    }

    result.error = errorMessage
    syncExitedCleanly = true
    return result
  } finally {
    if (!syncExitedCleanly) {
      try {
        await db
          .update(knowledgeConnector)
          .set({
            status: 'error',
            lastSyncError: 'Sync terminated unexpectedly',
            updatedAt: new Date(),
          })
          .where(eq(knowledgeConnector.id, connectorId))
        logger.warn('Reset stale syncing status in finally block', { connectorId })
      } catch (finallyError) {
        logger.warn('Failed to reset syncing status in finally block', {
          connectorId,
          error: toError(finallyError).message,
        })
      }
    }
  }
}

/** Owning workspace + user for a knowledge base, resolved once per sync. */
interface KnowledgeBaseOwner {
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

/**
 * Upload content to storage as a .txt file, create a document record,
 * and trigger processing via the existing pipeline.
 */
async function addDocument(
  knowledgeBaseId: string,
  connectorId: string,
  connectorType: string,
  extDoc: ExternalDocument,
  kbOwner: KnowledgeBaseOwner,
  sourceConfig?: Record<string, unknown>
): Promise<DocumentData> {
  const documentId = generateId()
  const contentBuffer = Buffer.from(extDoc.content, 'utf-8')
  const safeTitle = sanitizeStorageTitle(extDoc.title)
  const customKey = `kb/${Date.now()}-${documentId}-${safeTitle}.txt`

  const fileInfo = await StorageService.uploadFile({
    file: contentBuffer,
    fileName: `${safeTitle}.txt`,
    contentType: 'text/plain',
    context: 'knowledge-base',
    customKey,
    preserveKey: true,
    metadata: kbOwnershipMetadata(kbOwner, `${safeTitle}.txt`),
  })

  const fileUrl = `${getInternalApiBaseUrl()}${fileInfo.path}?context=knowledge-base`

  const tagValues = extDoc.metadata
    ? resolveTagMapping(connectorType, extDoc.metadata, sourceConfig)
    : undefined

  const processingFilename = `${safeTitle}.txt`

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
        fileSize: contentBuffer.length,
        mimeType: 'text/plain',
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
    filename: processingFilename,
    fileUrl,
    fileSize: contentBuffer.length,
    mimeType: 'text/plain',
  }
}

/**
 * Update an existing connector-sourced document with new content.
 * Updates in-place to avoid unique constraint violations on (connectorId, externalId).
 */
async function updateDocument(
  existingDocId: string,
  knowledgeBaseId: string,
  connectorId: string,
  connectorType: string,
  extDoc: ExternalDocument,
  kbOwner: KnowledgeBaseOwner,
  sourceConfig?: Record<string, unknown>
): Promise<DocumentData> {
  // Fetch old file URL before uploading replacement
  const existingRows = await db
    .select({ fileUrl: document.fileUrl })
    .from(document)
    .where(eq(document.id, existingDocId))
    .limit(1)
  const oldFileUrl = existingRows[0]?.fileUrl

  const contentBuffer = Buffer.from(extDoc.content, 'utf-8')
  const safeTitle = sanitizeStorageTitle(extDoc.title)
  const customKey = `kb/${Date.now()}-${existingDocId}-${safeTitle}.txt`

  const fileInfo = await StorageService.uploadFile({
    file: contentBuffer,
    fileName: `${safeTitle}.txt`,
    contentType: 'text/plain',
    context: 'knowledge-base',
    customKey,
    preserveKey: true,
    metadata: kbOwnershipMetadata(kbOwner, `${safeTitle}.txt`),
  })

  const fileUrl = `${getInternalApiBaseUrl()}${fileInfo.path}?context=knowledge-base`

  const tagValues = extDoc.metadata
    ? resolveTagMapping(connectorType, extDoc.metadata, sourceConfig)
    : undefined

  const processingFilename = `${safeTitle}.txt`

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
          fileSize: contentBuffer.length,
          contentHash: extDoc.contentHash,
          sourceUrl: extDoc.sourceUrl ?? null,
          ...tagValues,
          processingStatus: 'pending',
          uploadedAt: new Date(),
        })
        .where(
          and(
            eq(document.id, existingDocId),
            isNull(document.archivedAt),
            isNull(document.deletedAt)
          )
        )
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
    filename: processingFilename,
    fileUrl,
    fileSize: contentBuffer.length,
    mimeType: 'text/plain',
  }
}
