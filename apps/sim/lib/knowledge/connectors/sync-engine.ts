import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorSyncLog,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { randomInt } from '@sim/utils/random'
import { and, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { decryptApiKey } from '@/lib/api-key/crypto'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import type { DocumentData } from '@/lib/knowledge/documents/service'
import { hardDeleteDocuments, processDocumentsWithQueue } from '@/lib/knowledge/documents/service'
import { StorageService } from '@/lib/uploads'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'
import { extractStorageKey } from '@/lib/uploads/utils/file-utils'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
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
/** Estimated source bytes for a doc whose listing did not report a size. */
const DEFAULT_OP_SIZE_BYTES = 4 * 1024 * 1024
/**
 * Max summed source bytes hydrated/uploaded concurrently within a batch. Each
 * in-flight file materializes as a content string plus an upload buffer, so this
 * bounds peak worker memory: a few large files near the per-file cap are processed
 * in smaller sub-chunks instead of all at once, while small files still process up
 * to SYNC_BATCH_SIZE at a time.
 */
const CONTENT_INFLIGHT_BUDGET_BYTES = 64 * 1024 * 1024
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
  | { type: 'skip'; extDoc: ExternalDocument }

type DocClassification =
  | { type: 'add' }
  | { type: 'update'; existingId: string }
  | { type: 'skip' }
  | { type: 'unchanged' }
  | { type: 'drop' }

/**
 * Decides what a listed external document becomes during reconciliation.
 *
 * - `skip`: connector flagged it (e.g. too large) and it is not already indexed —
 *   record a visible `failed` document instead of dropping it silently. A file that
 *   is already indexed is kept as-is (last-known-good) rather than downgraded.
 * - `drop`: empty, non-deferred content that cannot be indexed.
 * - `add` / `update` / `unchanged`: normal content reconciliation by content hash.
 *
 * `forceRehydrate` (set on a full resync of a `rehydrateOnFullSync` connector) promotes
 * an otherwise-`unchanged` deferred document to `update` so its content is re-fetched —
 * needed when rendered content can drift without the hash changing (e.g. Confluence
 * transclusions). Non-deferred docs already carry final content from listing, so they
 * are left `unchanged` (re-indexing identical content would be pointless).
 */
export function classifyExternalDoc(
  extDoc: Pick<ExternalDocument, 'content' | 'contentDeferred' | 'contentHash' | 'skippedReason'>,
  existing: { id: string; contentHash: string | null } | undefined,
  forceRehydrate = false
): DocClassification {
  if (extDoc.skippedReason) {
    return existing ? { type: 'unchanged' } : { type: 'skip' }
  }
  if (!extDoc.content.trim() && !extDoc.contentDeferred) {
    return { type: 'drop' }
  }
  if (!existing) {
    return { type: 'add' }
  }
  if (existing.contentHash !== extDoc.contentHash) {
    return { type: 'update', existingId: existing.id }
  }
  if (forceRehydrate && extDoc.contentDeferred) {
    return { type: 'update', existingId: existing.id }
  }
  return { type: 'unchanged' }
}

/** Estimated source bytes for a pending op, taken from its listing metadata. */
function estimateOpSizeBytes(op: DocOp): number {
  // Skip ops load no content (just a row insert), so they do not count against the
  // in-flight content budget.
  if (op.type === 'skip') return 0
  const size = op.extDoc.metadata?.fileSize ?? op.extDoc.metadata?.size
  return typeof size === 'number' && Number.isFinite(size) && size > 0
    ? size
    : DEFAULT_OP_SIZE_BYTES
}

/**
 * Splits content ops into sub-chunks bounded by both a count (maxCount) and a summed
 * byte budget, so large files are hydrated/uploaded a few at a time. A single op
 * larger than the budget still forms its own chunk (always >= 1 op per chunk).
 */
export function chunkOpsByByteBudget(
  ops: DocOp[],
  budgetBytes: number,
  maxCount: number
): DocOp[][] {
  const chunks: DocOp[][] = []
  let current: DocOp[] = []
  let currentBytes = 0
  for (const op of ops) {
    const bytes = estimateOpSizeBytes(op)
    if (current.length > 0 && (current.length >= maxCount || currentBytes + bytes > budgetBytes)) {
      chunks.push(current)
      current = []
      currentBytes = 0
    }
    current.push(op)
    currentBytes += bytes
  }
  if (current.length > 0) {
    chunks.push(current)
  }
  return chunks
}

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

/** A stored document's identity, as read back for reconciliation. */
type ReconciliationDoc = { id: string; externalId: string | null }

/**
 * Partitions a connector's stored documents against the current listing into
 * the three reconciliation actions.
 *
 * A document absent from a normal (non-fullSync) listing is never purged
 * immediately — an empty or shrunken listing can equally mean a transient
 * source outage, and a single bad observation must never cause an
 * irreversible mass deletion. It is instead marked pending-removal
 * (`softDeleteIds`), and only becomes eligible for hard deletion
 * (`hardDeleteIds`) once a *later* sync confirms it's still absent — i.e. it
 * was already pending-removal (`tombstonedDocs`) coming into this sync. A
 * document that reappears while pending-removal is resurrected
 * (`resurrectIds`) regardless of `fullSync`, since presence — unlike absence —
 * is trustworthy evidence even from a partial listing.
 *
 * A forced `fullSync` is an explicit request to reconcile right now: it skips
 * the grace period and purges everything absent in one pass.
 */
export function partitionSyncReconciliation(
  existingDocs: ReconciliationDoc[],
  tombstonedDocs: ReconciliationDoc[],
  seenExternalIds: Set<string>,
  fullSync: boolean | undefined
): { resurrectIds: string[]; softDeleteIds: string[]; hardDeleteIds: string[] } {
  const resurrectIds = tombstonedDocs
    .filter((d) => d.externalId && seenExternalIds.has(d.externalId))
    .map((d) => d.id)
  const liveMissingIds = existingDocs
    .filter((d) => d.externalId && !seenExternalIds.has(d.externalId))
    .map((d) => d.id)
  const tombstonedStillMissingIds = tombstonedDocs
    .filter((d) => d.externalId && !seenExternalIds.has(d.externalId))
    .map((d) => d.id)

  if (fullSync) {
    return {
      resurrectIds,
      softDeleteIds: [],
      hardDeleteIds: [...liveMissingIds, ...tombstonedStillMissingIds],
    }
  }
  return { resurrectIds, softDeleteIds: liveMissingIds, hardDeleteIds: tombstonedStillMissingIds }
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
  options: {
    billingAttribution: BillingAttributionSnapshot
    fullSync?: boolean
    rehydrate?: boolean
  }
): Promise<SyncResult> {
  const billingAttribution = assertBillingAttributionSnapshot(options?.billingAttribution)
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
  if (!kbOwner.workspaceId) {
    throw new Error(
      `Knowledge base ${connector.knowledgeBaseId} is missing workspace billing context`
    )
  }
  if (billingAttribution.workspaceId !== kbOwner.workspaceId) {
    throw new Error(
      `Connector sync billing attribution does not match knowledge base workspace ${kbOwner.workspaceId}`
    )
  }
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

    /**
     * Determine if this sync should be incremental. A `rehydrate` request forces a
     * full listing too: re-hydration must see *every* document (a container page can
     * be unchanged itself yet transclude a page that changed), and an incremental
     * listing would omit those unchanged containers, so they'd never be re-fetched.
     */
    const isIncremental =
      connectorConfig.supportsIncrementalSync &&
      connector.syncMode !== 'full' &&
      !options?.fullSync &&
      !options?.rehydrate &&
      connector.lastSyncAt != null
    const lastSyncAt =
      isIncremental && connector.lastSyncAt ? new Date(connector.lastSyncAt) : undefined

    /**
     * Re-hydrate and re-index connectors whose rendered content can drift without a
     * hash change (transclusions) — see `ConnectorMeta.rehydrateOnFullSync`. Driven
     * by the dedicated `rehydrate` request (the "Full resync" action) or implied by a
     * true `fullSync`. It forces a full listing (above) and re-indexes unchanged
     * deferred docs, but — unlike `fullSync` — it does NOT bypass any
     * deletion-reconciliation safety guard. Incremental syncs of other connectors
     * stay hash-gated.
     */
    const forceRehydrate = Boolean(
      (options?.rehydrate || options?.fullSync) && connectorConfig.rehydrateOnFullSync
    )

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

    const [existingDocs, tombstonedDocs, excludedDocs] = await Promise.all([
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
      // Docs already marked pending-removal by a prior sync's reconciliation (see
      // shouldReconcileDeletions below): absent from the source once, not yet
      // absent twice in a row. Included in classification so a document that
      // reappears is recognized as existing (resurrected) rather than re-added
      // as a duplicate.
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
            isNotNull(document.deletedAt)
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

    const priorByExternalId = new Map(
      [...existingDocs, ...tombstonedDocs]
        .filter((d) => d.externalId !== null)
        .map((d) => [d.externalId!, d])
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

      const existing = priorByExternalId.get(extDoc.externalId)
      const classification = classifyExternalDoc(extDoc, existing, forceRehydrate)

      switch (classification.type) {
        case 'skip':
          pendingOps.push({ type: 'skip', extDoc })
          break
        case 'drop':
          logger.info(`Skipping empty document: ${extDoc.title}`, {
            externalId: extDoc.externalId,
          })
          break
        case 'add':
          pendingOps.push({ type: 'add', extDoc })
          break
        case 'update':
          pendingOps.push({ type: 'update', existingId: classification.existingId, extDoc })
          break
        case 'unchanged':
          result.docsUnchanged++
          break
      }
    }

    // Batch by both count and summed content bytes so a few large files near the
    // per-file cap never hydrate/upload together and exhaust the worker heap.
    const batches = chunkOpsByByteBudget(pendingOps, CONTENT_INFLIGHT_BUDGET_BYTES, SYNC_BATCH_SIZE)
    for (const rawBatch of batches) {
      const liveness = await checkSyncLiveness(connectorId, connector.knowledgeBaseId)
      if (liveness.connectorDeleted) {
        throw new ConnectorDeletedException(connectorId)
      }
      if (liveness.knowledgeBaseDeleted) {
        throw new Error(`Knowledge base ${connector.knowledgeBaseId} was deleted during sync`)
      }

      // Oversized/skipped docs become visible `failed` rows (never silent). They are
      // flagged either at listing time (skip ops here) or discovered only at fetch
      // time during hydration below; both are collected and persisted after hydration.
      const skipExtDocs: ExternalDocument[] = rawBatch
        .filter((op) => op.type === 'skip')
        .map((op) => op.extDoc)

      const contentOps = rawBatch.filter((op) => op.type !== 'skip')
      const deferredOps = contentOps.filter((op) => op.extDoc.contentDeferred)
      const readyOps = contentOps.filter((op) => !op.extDoc.contentDeferred)

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
            // A connector may only learn a file is too large at fetch time (its
            // listing has no size). Surface that as a failed row for new files; keep
            // already-indexed files as last-known-good rather than downgrading them.
            if (fullDoc?.skippedReason) {
              if (op.type === 'add') {
                skipExtDocs.push({
                  ...op.extDoc,
                  skippedReason: fullDoc.skippedReason,
                  contentHash: fullDoc.contentHash ?? op.extDoc.contentHash,
                  metadata: { ...op.extDoc.metadata, ...fullDoc.metadata },
                })
              } else if (op.type === 'update') {
                // Already-indexed file is kept as last-known-good (not downgraded), so it
                // counts as unchanged rather than slipping past every result counter.
                result.docsUnchanged++
              }
              return null
            }
            if (!fullDoc?.content.trim()) {
              // An empty re-fetch leaves an already-indexed update as last-known-good; count
              // it as unchanged so the totals still reconcile with documents seen.
              if (op.type === 'update') result.docsUnchanged++
              return null
            }
            const hydratedHash = fullDoc.contentHash ?? op.extDoc.contentHash
            /**
             * Normally an update whose hydrated hash matches the stored hash is a
             * no-op (content unchanged). On a forced re-hydration the hash is
             * version-based and cannot reflect the rendered-dependency change we are
             * refreshing for, so re-index unconditionally instead of skipping.
             */
            if (
              op.type === 'update' &&
              !forceRehydrate &&
              priorByExternalId.get(op.extDoc.externalId)?.contentHash === hydratedHash
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
              error: getErrorMessage(outcome.reason),
            })
          }
        }
      }

      // Record all skipped (oversized) docs in this batch in one bulk insert.
      if (skipExtDocs.length > 0) {
        try {
          const recorded = await skipDocuments(
            connector.knowledgeBaseId,
            connectorId,
            connector.connectorType,
            skipExtDocs,
            sourceConfig
          )
          result.docsFailed += recorded
        } catch (error) {
          result.docsFailed += skipExtDocs.length
          logger.error('Failed to record skipped documents', {
            connectorId,
            count: skipExtDocs.length,
            error: toError(error).message,
          })
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
            error: getErrorMessage(outcome.reason),
          })
        }
      }

      if (batchDocs.length > 0) {
        try {
          await processDocumentsWithQueue(
            batchDocs,
            connector.knowledgeBaseId,
            {},
            generateId(),
            billingAttribution
          )
        } catch (error) {
          logger.warn('Failed to enqueue batch for processing — will retry on next sync', {
            connectorId,
            count: batchDocs.length,
            error: toError(error).message,
          })
        }
      }
    }

    const { resurrectIds, softDeleteIds, hardDeleteIds } = partitionSyncReconciliation(
      existingDocs,
      tombstonedDocs,
      seenExternalIds,
      options?.fullSync
    )

    /**
     * A document reappearing at the source is trustworthy evidence on its own —
     * unlike absence, presence never depends on the listing being complete — so
     * resurrection runs unconditionally, even on an incremental or otherwise
     * gated sync.
     */
    if (resurrectIds.length > 0) {
      await db.update(document).set({ deletedAt: null }).where(inArray(document.id, resurrectIds))
      logger.info(`Resurrected ${resurrectIds.length} documents that reappeared at the source`, {
        connectorId,
      })
    }

    if (shouldReconcileDeletions(isIncremental, syncContext, options?.fullSync)) {
      if (softDeleteIds.length > 0) {
        await db
          .update(document)
          .set({ deletedAt: new Date() })
          .where(inArray(document.id, softDeleteIds))
        logger.info(
          `Marked ${softDeleteIds.length} documents pending removal — absent from source, confirming on next sync`,
          { connectorId }
        )
      }
      if (hardDeleteIds.length > 0) {
        await hardDeleteDocuments(hardDeleteIds, syncLogId)
        result.docsDeleted += hardDeleteIds.length
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
          // Skipped (oversized) docs are recorded as content-less failed rows with no
          // storage key; they cannot be reprocessed, so exclude them from retry.
          isNotNull(document.storageKey),
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
          generateId(),
          billingAttribution
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
        // Includes pending-removal (tombstoned) docs — the connector is gone, so
        // there's no future sync left to confirm or resurrect them.
        const connectorDocs = await db
          .select({ id: document.id })
          .from(document)
          .where(and(eq(document.connectorId, connectorId), isNull(document.archivedAt)))

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
 * Records source files that were intentionally not indexed (e.g. they exceed the
 * connector's size limit) as content-less `failed` documents in a single bulk insert.
 * This keeps the files visible in the knowledge base UI — with `processingError`
 * explaining why — instead of silently dropping them. The rows have no storage key,
 * so they are excluded from the stuck-document retry sweep (nothing to reprocess).
 *
 * Only called for files not already indexed; previously-indexed files that later
 * exceed the limit are kept as-is (last-known-good) by `classifyExternalDoc`.
 *
 * Returns the number of rows recorded.
 */
async function skipDocuments(
  knowledgeBaseId: string,
  connectorId: string,
  connectorType: string,
  extDocs: ExternalDocument[],
  sourceConfig?: Record<string, unknown>
): Promise<number> {
  if (extDocs.length === 0) {
    return 0
  }
  const rows = extDocs.map((extDoc) =>
    buildSkippedDocumentRow(knowledgeBaseId, connectorId, connectorType, extDoc, sourceConfig)
  )

  await db.transaction(async (tx) => {
    const isActive = await isKnowledgeBaseActiveInTx(tx, knowledgeBaseId)
    if (!isActive) {
      throw new Error(`Knowledge base ${knowledgeBaseId} is deleted`)
    }

    await tx.insert(document).values(rows)
  })

  return rows.length
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
          // A tombstoned document reappearing with changed content is resurrected
          // in the same write as its content update — otherwise reconciliation's
          // separate resurrect step would clear deletedAt while this update, gated
          // on deletedAt IS NULL, rejects the row and leaves stale content active.
          deletedAt: null,
        })
        .where(and(eq(document.id, existingDocId), isNull(document.archivedAt)))
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
