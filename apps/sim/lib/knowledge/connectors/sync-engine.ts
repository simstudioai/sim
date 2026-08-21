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
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm'
import { decryptApiKey } from '@/lib/api-key/crypto'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { resolveCredentialTokenIdentity } from '@/lib/credentials/access'
import type { DocumentData } from '@/lib/knowledge/documents/service'
import { hardDeleteDocuments, processDocumentsWithQueue } from '@/lib/knowledge/documents/service'
import { refreshAccessTokenIfNeeded } from '@/lib/oauth/credential-service'
import { StorageService } from '@/lib/uploads'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { deleteFileMetadata } from '@/lib/uploads/server/metadata'
import { extractStorageKey } from '@/lib/uploads/utils/file-utils'
import { CONNECTOR_REGISTRY } from '@/connectors/registry.server'
import type {
  ConnectorAuthConfig,
  DocumentTags,
  ExternalDocument,
  SyncResult,
} from '@/connectors/types'
import { hasIndexablePayload } from '@/connectors/utils'

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
/** Largest connector corpus observed in production, which sets the queue drain to beat. */
const LARGEST_OBSERVED_CORPUS_DOCUMENTS = 7_730
/** `document-processing-queue`'s `concurrencyLimit` — global, shared by every workspace. */
const PROCESSING_QUEUE_CONCURRENCY = 20
/** Wall time a typical document occupies a queue slot, parse through embedding. */
const TYPICAL_DOCUMENT_OCCUPANCY_MINUTES = 1
/** Headroom for the queue being shared: another tenant's backlog cuts our share of it. */
const QUEUE_CONTENTION_FACTOR = 2
/**
 * Grace period a document waiting on the processing queue gets before the
 * stuck-document sweep may reclaim it.
 *
 * Derived rather than chosen, so the next person can re-run the arithmetic with
 * their own numbers instead of trusting this one: the sweep must not reclaim a
 * document that a full queue drain has simply not reached yet, so the grace is
 * that drain — corpus / concurrency x per-document occupancy — times a
 * contention factor for the queue being shared across workspaces. At the values
 * above that is 7,730 / 20 x 1 x 2 = 773 minutes, just under thirteen hours.
 *
 * Each input is measurable and should be re-measured when it moves: corpus size
 * from the largest connector in production, concurrency from
 * `knowledge-process-document`'s queue config, occupancy from run durations.
 * Note the failure mode is asymmetric — too small silently re-bills live work,
 * too large only delays recovery of documents nothing is processing — so round
 * up, never down.
 */
const QUEUED_DISPATCH_GRACE_MINUTES = Math.ceil(
  (LARGEST_OBSERVED_CORPUS_DOCUMENTS / PROCESSING_QUEUE_CONCURRENCY) *
    TYPICAL_DOCUMENT_OCCUPANCY_MINUTES *
    QUEUE_CONTENTION_FACTOR
)
const RETRY_WINDOW_DAYS = 7
const MAX_CONSECUTIVE_FAILURES = 10
const RUNNABLE_CONNECTOR_STATUSES = ['active', 'error'] as const

/** Whether an automatic connector sync may begin from this persisted state. */
export function isConnectorRunnableStatus(status: string): boolean {
  return RUNNABLE_CONNECTOR_STATUSES.some((runnableStatus) => runnableStatus === status)
}

/** The processing state the stuck-document sweep decides on, one row at a time. */
export interface StuckDocumentSweepCandidate {
  processingStatus: string
  processingQueuedAt: Date | null
  processingStartedAt: Date | null
  processingCompletedAt: Date | null
  uploadedAt: Date
}

/**
 * Decides whether the sweep may reclaim one document — delete its embeddings,
 * reset it, and dispatch it again.
 *
 * Since document processing is dispatched to `knowledge-process-document`
 * rather than awaited inline, a document sits at `pending` from dispatch until
 * a worker claims it; `processing` is only written once a worker has actually
 * started. Reclaiming a `pending` document therefore risks racing a run that is
 * still queued, which both duplicates its work and bills a second indexing
 * pass, so queued documents get {@link QUEUED_DISPATCH_GRACE_MINUTES} before
 * they are considered lost.
 *
 * Queue wait is measured from `processingQueuedAt`, stamped by
 * `processDocumentsWithQueue` — the funnel every dispatch passes through — so
 * no caller can dispatch without recording when. It falls back to `uploadedAt`
 * when NULL, which covers rows written before the column existed.
 *
 * `failed` is not a terminal state and gets the same grace. `processDocumentAsync`
 * records the failure and then rethrows, so `knowledge-process-document` retries
 * it up to `maxAttempts` (3): between attempts the row reads `failed` while a
 * live run is scheduled to pick it up again. The gap between attempts is bounded
 * by the queue, not by run duration — a retried run re-enters the same queue
 * behind the same global concurrency limit — so `maxDuration` x `maxAttempts`
 * (30 minutes) and `STALE_PROCESSING_MINUTES` are both far too short to be safe
 * here: on the very backlog this grace exists for, the next attempt starts hours
 * after the last one ended. `failed` is therefore aged from
 * `processingCompletedAt`, the instant the last attempt ended, which every
 * failure write stamps.
 *
 * A document whose retries genuinely exhaust is still recovered: its final
 * failure stops moving `processingCompletedAt`, so one grace later it becomes
 * eligible and the next sync re-dispatches it. Recovery is delayed by the grace,
 * never lost. The user-facing retry stays immediate — it writes `pending` and
 * dispatches without consulting the sweep at all.
 *
 * This narrows the duplicate-dispatch window; it cannot close it. A grace
 * period is a timing guarantee, and no timing guarantee is a correctness one:
 * a document queued for longer than the grace is still reclaimed while its
 * original run waits, and Trigger.dev will not deduplicate the second dispatch
 * because the idempotency key `processDocumentsWithQueue` uses is
 * `doc-process-<documentId>-<requestId>` with a fresh `requestId` per dispatch
 * — scoped per dispatch by design, so it blocks intra-dispatch retries and
 * nothing else. Each duplicate run mints its own indexing pass and bills for
 * it, which is the double-billing `451d2ccbde` closed for the inline path.
 * Closing it durably needs state, not timing: a document-scoped idempotency
 * key, or a dispatch-generation column the worker carries and checks before
 * indexing, so a superseded run declines to bill. That is a larger change than
 * this hotfix.
 */
export function isStuckDocumentSweepEligible(doc: StuckDocumentSweepCandidate, now: Date): boolean {
  switch (doc.processingStatus) {
    case 'failed': {
      const lastAttemptEndedAt =
        doc.processingCompletedAt ?? doc.processingQueuedAt ?? doc.uploadedAt
      return (
        now.getTime() - lastAttemptEndedAt.getTime() > QUEUED_DISPATCH_GRACE_MINUTES * 60 * 1000
      )
    }
    case 'pending': {
      const queuedAt = doc.processingQueuedAt ?? doc.uploadedAt
      return now.getTime() - queuedAt.getTime() > QUEUED_DISPATCH_GRACE_MINUTES * 60 * 1000
    }
    case 'processing': {
      if (!doc.processingStartedAt) return true
      return (
        now.getTime() - doc.processingStartedAt.getTime() > STALE_PROCESSING_MINUTES * 60 * 1000
      )
    }
    default:
      return false
  }
}

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
  extDoc: Pick<
    ExternalDocument,
    'content' | 'sourceFile' | 'contentDeferred' | 'contentHash' | 'skippedReason'
  >,
  existing: { id: string; contentHash: string | null } | undefined,
  forceRehydrate = false
): DocClassification {
  if (extDoc.skippedReason) {
    return existing ? { type: 'unchanged' } : { type: 'skip' }
  }
  if (!hasIndexablePayload(extDoc) && !extDoc.contentDeferred) {
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

/**
 * Merges a hydrated document over the listing stub it was fetched for.
 *
 * Every field the connector restates on hydration has to be carried, not just the
 * content. A stub is built before the file is fetched and declares `text/plain`,
 * so any field left behind keeps a value that is wrong for the bytes now attached
 * — which is how a hydrated PDF ends up still claiming plain text. Storage reads
 * `sourceFile.mimeType`, so that particular staleness is invisible until
 * something reaches for the obvious field instead.
 *
 * Extracted from the hydration loop so the merge is a stated contract with a test
 * rather than an inline spread that is easy to under-specify.
 */
export function mergeHydratedDocument(
  stub: ExternalDocument,
  hydrated: ExternalDocument,
  contentHash: string
): ExternalDocument {
  return {
    ...stub,
    title: hydrated.title || stub.title,
    content: hydrated.content,
    sourceFile: hydrated.sourceFile,
    mimeType: hydrated.mimeType,
    contentHash,
    contentDeferred: false,
    sourceUrl: hydrated.sourceUrl ?? stub.sourceUrl,
    metadata: { ...stub.metadata, ...hydrated.metadata },
  }
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

/**
 * Minimum number of documents a connector must still own before an empty
 * listing is treated as suspect. Below it, an empty listing is far more likely
 * to be a genuinely emptied source than a broken one, the blast radius of
 * reconciling is a handful of documents, and any ratio-based judgement is
 * statistically meaningless.
 */
const SUSPECT_LISTING_MIN_OWNED_DOCS = 3
/**
 * Minimum owned-document count before the proportional (collapse) guard
 * applies. A source can legitimately shrink hard when it is small — going from
 * 8 documents to 1 is ordinary editing — so the collapse guard only engages on
 * corpora large enough that a near-total disappearance in a single sync is
 * implausible without an upstream fault.
 */
const SUSPECT_COLLAPSE_MIN_OWNED_DOCS = 50
/**
 * A listing covering less than this fraction of the documents the connector
 * still owns is treated as suspect. Deliberately far below any plausible
 * bulk edit (10% means 10,000 documents collapsing to under 1,000) so normal
 * housekeeping never trips it, while the partial-outage shapes seen in the
 * wild — an auth wall or an interstitial served for most of a source — do.
 */
const SUSPECT_COLLAPSE_MAX_RATIO = 0.1

/** Why a listing is considered untrustworthy evidence of deletion. */
export type SuspectListingReason = 'empty' | 'collapsed'

/**
 * A prior sync's listing, reconstructed from its sync-log counters.
 *
 * `trustworthy` is false when that run could have been an incremental listing:
 * an incremental run that observed no changes is indistinguishable from a full
 * run that observed nothing, and treating the former as corroboration would let
 * a single bad listing confirm itself.
 */
export interface PreviousListingObservation {
  listedCount: number
  ownedCount: number
  trustworthy: boolean
}

/**
 * Classifies a listing as untrustworthy evidence that documents were deleted.
 *
 * A connector that returns nothing (or almost nothing) while the knowledge base
 * still holds a real corpus for it is far more likely to be broken than to be
 * reporting a genuinely emptied source: observed causes include an HTTP 200
 * interstitial served instead of an index, and a source moved behind auth.
 * Neither surfaces as an error, so the sync looks clean and the listing looks
 * authoritative.
 */
export function classifySuspectListing(
  listedCount: number,
  ownedCount: number
): SuspectListingReason | null {
  if (ownedCount < SUSPECT_LISTING_MIN_OWNED_DOCS) return null
  if (listedCount === 0) return 'empty'
  if (
    ownedCount >= SUSPECT_COLLAPSE_MIN_OWNED_DOCS &&
    listedCount < ownedCount * SUSPECT_COLLAPSE_MAX_RATIO
  ) {
    return 'collapsed'
  }
  return null
}

/**
 * Decides whether a suspect listing may still reconcile deletions.
 *
 * A suspect listing is only acted on once the *same* observation repeats on a
 * consecutive sync, so a single transient upstream fault can never remove
 * documents — not even reversibly, since a soft delete hides them from search
 * immediately. A genuinely emptied source keeps reconciling: its second sync
 * corroborates the first, tombstones everything, and the third sync completes
 * the existing two-strike purge.
 *
 * A forced `fullSync` overrides the guard, matching its existing meaning
 * elsewhere here — an explicit human request to reconcile against this listing
 * right now.
 */
export function evaluateListingSafety(
  listedCount: number,
  ownedCount: number,
  previous: PreviousListingObservation | null,
  fullSync: boolean | undefined
): { reason: SuspectListingReason | null; blocked: boolean; corroborated: boolean } {
  const reason = classifySuspectListing(listedCount, ownedCount)
  if (!reason) return { reason: null, blocked: false, corroborated: false }
  if (fullSync) return { reason, blocked: false, corroborated: false }

  const corroborated = Boolean(
    previous?.trustworthy && classifySuspectListing(previous.listedCount, previous.ownedCount)
  )
  return { reason, blocked: !corroborated, corroborated }
}

/**
 * Reconstructs the previous completed sync's listing from its log counters.
 *
 * No schema change is needed: every document the previous run listed landed in
 * exactly one of added/updated/unchanged/failed, and `lastSyncDocCount` records
 * how many documents the connector owned when that run finished. Documents the
 * user excluded also land in `docsUnchanged`, which can only inflate the
 * reconstructed listing — erring toward "the previous listing looked healthy",
 * i.e. toward blocking deletions.
 */
async function loadPreviousListingObservation(
  connectorId: string,
  currentSyncLogId: string,
  previousOwnedCount: number,
  trustworthy: boolean
): Promise<PreviousListingObservation | null> {
  const rows = await db
    .select({
      docsAdded: knowledgeConnectorSyncLog.docsAdded,
      docsUpdated: knowledgeConnectorSyncLog.docsUpdated,
      docsUnchanged: knowledgeConnectorSyncLog.docsUnchanged,
      docsFailed: knowledgeConnectorSyncLog.docsFailed,
    })
    .from(knowledgeConnectorSyncLog)
    .where(
      and(
        eq(knowledgeConnectorSyncLog.connectorId, connectorId),
        eq(knowledgeConnectorSyncLog.status, 'completed'),
        ne(knowledgeConnectorSyncLog.id, currentSyncLogId)
      )
    )
    .orderBy(desc(knowledgeConnectorSyncLog.startedAt))
    .limit(1)

  const previous = rows[0]
  if (!previous) return null

  return {
    listedCount:
      previous.docsAdded + previous.docsUpdated + previous.docsUnchanged + previous.docsFailed,
    ownedCount: previousOwnedCount,
    trustworthy,
  }
}

/**
 * Decides whether a sync should use the connector's incremental listing.
 *
 * A pending-removal document only surfaces in an incremental listing if its
 * content changed since last sync — an unchanged-but-still-present document
 * never appears in an incremental delta at all, so it could never be
 * resurrected and would stay tombstoned indefinitely on a connector that runs
 * incrementally from here on. `hasTombstonedDocs` forces a full listing
 * whenever any pending-removal document exists for this connector, so every
 * one of them gets a real resurrect-or-confirm decision on this sync.
 */
export function shouldRunIncrementalSync(
  supportsIncrementalSync: boolean | undefined,
  syncMode: string | null | undefined,
  fullSync: boolean | undefined,
  rehydrate: boolean | undefined,
  hasTombstonedDocs: boolean,
  lastSyncAt: string | Date | null | undefined
): boolean {
  return Boolean(
    supportsIncrementalSync &&
      syncMode !== 'full' &&
      !fullSync &&
      !hasTombstonedDocs &&
      !rehydrate &&
      lastSyncAt != null
  )
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
 * is trustworthy evidence even from a partial listing. A document whose
 * content refresh was attempted but failed (`failedExternalIds`) is excluded
 * from resurrection even though it was seen — surfacing it now would show
 * known-stale pre-tombstone content; it stays tombstoned for a later sync to
 * retry.
 *
 * A forced `fullSync` is an explicit request to reconcile right now: it skips
 * the grace period and purges everything absent in one pass.
 */
export function partitionSyncReconciliation(
  existingDocs: ReconciliationDoc[],
  tombstonedDocs: ReconciliationDoc[],
  seenExternalIds: Set<string>,
  failedExternalIds: Set<string>,
  fullSync: boolean | undefined
): { resurrectIds: string[]; softDeleteIds: string[]; hardDeleteIds: string[] } {
  const resurrectIds = tombstonedDocs
    .filter(
      (d) =>
        d.externalId && seenExternalIds.has(d.externalId) && !failedExternalIds.has(d.externalId)
    )
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
 * Re-filters the three reconciliation ID lists against a fresh ownership
 * snapshot taken under the connector's `FOR UPDATE` lock, dropping any
 * document a concurrent "delete connector, keep documents" request already
 * detached (its `connectorId` no longer matches) since the lists were first
 * computed.
 */
export function filterStillOwnedReconciliationIds(
  resurrectIds: string[],
  softDeleteIds: string[],
  hardDeleteIds: string[],
  stillOwnedIds: Set<string>
): { resurrectIds: string[]; softDeleteIds: string[]; hardDeleteIds: string[] } {
  return {
    resurrectIds: resurrectIds.filter((id) => stillOwnedIds.has(id)),
    softDeleteIds: softDeleteIds.filter((id) => stillOwnedIds.has(id)),
    hardDeleteIds: hardDeleteIds.filter((id) => stillOwnedIds.has(id)),
  }
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
 *
 * `userId` must be the user who owns the credential's OAuth account — not the
 * knowledge base owner. Workspace-scoped credentials are routinely authorized by
 * a different member, and token reads are scoped to `account.userId`.
 */
async function resolveAccessToken(
  connector: { credentialId: string | null; encryptedApiKey: string | null },
  connectorConfig: { auth: ConnectorAuthConfig },
  userId: string
): Promise<string> {
  if (connectorConfig.auth.mode === 'apiKey') {
    if (!connector.encryptedApiKey) {
      if (connectorConfig.auth.optional) {
        return ''
      }
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
    requireRunnable?: boolean
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

  if (options.requireRunnable && !isConnectorRunnableStatus(connector.status)) {
    logger.info('Skipping automatic sync: connector is not runnable', {
      connectorId,
      status: connector.status,
    })
    return result
  }

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
        options.requireRunnable
          ? inArray(knowledgeConnector.status, RUNNABLE_CONNECTOR_STATUSES)
          : ne(knowledgeConnector.status, 'syncing'),
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
    /**
     * OAuth credentials are workspace-scoped and shared, so the member who authorized
     * one is often not the knowledge base owner. Resolve the credential's own account
     * owner — token reads are scoped to `account.userId`, so passing the KB owner
     * resolves no token at all. Resolved once here rather than inside
     * `resolveAccessToken` so per-page refreshes don't repeat the lookup.
     */
    let credentialUserId = userId
    if (connectorConfig.auth.mode === 'oauth' && connector.credentialId) {
      const identity = await resolveCredentialTokenIdentity(
        connector.credentialId,
        kbOwner.workspaceId
      )
      if (!identity) {
        throw new Error(
          `Credential ${connector.credentialId} is not usable from workspace ${kbOwner.workspaceId} — reconnect the credential`
        )
      }
      // Service accounts mint their own token and ignore the acting user.
      if (identity.kind === 'oauth') {
        credentialUserId = identity.userId
      }
    }

    let accessToken = await resolveAccessToken(connector, connectorConfig, credentialUserId)

    const externalDocs: ExternalDocument[] = []
    let cursor: string | undefined
    let hasMore = true
    const syncContext: Record<string, unknown> = { syncRunId: generateId() }

    // Shared cutoff for both the tombstone-retry bound below and the stuck-document
    // retry near the end of this sync — same RETRY_WINDOW_DAYS window, one computation.
    const retryCutoff = new Date(Date.now() - RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000)

    /**
     * Bounded to the same retry window as the stuck-document retry below: a
     * document whose refresh keeps failing every sync (e.g. permanently
     * oversized) would otherwise be a tombstone that never resolves, forcing a
     * full listing — and its listing-time overhead — for this connector
     * forever. Past the window, this connector stops forcing full syncs on its
     * account; the document itself is unaffected and stays tombstoned either way.
     *
     * Known accepted trade-off: once past the window, a still-tombstoned
     * document that's unchanged-but-genuinely-present at the source can only
     * be resurrected by a full listing — and nothing here forces one anymore.
     * On a connector that never runs a full sync again (persistent incremental
     * syncMode, no manual full resync), that document stays correctly
     * invisible (excluded everywhere by `isNull(deletedAt)`, so no
     * search/billing/listing leakage) but unresolved indefinitely. This is
     * deliberately not "fixed" by hard-deleting it after the window expires —
     * that would delete a document we have no positive evidence is actually
     * gone, reintroducing the exact risk this whole design exists to avoid.
     */
    const hasTombstonedDocs = await db
      .select({ id: document.id })
      .from(document)
      .where(
        and(
          eq(document.connectorId, connectorId),
          isNull(document.archivedAt),
          isNotNull(document.deletedAt),
          gt(document.deletedAt, retryCutoff)
        )
      )
      .limit(1)
      .then((rows) => rows.length > 0)

    /**
     * Determine if this sync should be incremental. A `rehydrate` request forces a
     * full listing too: re-hydration must see *every* document (a container page can
     * be unchanged itself yet transclude a page that changed), and an incremental
     * listing would omit those unchanged containers, so they'd never be re-fetched.
     */
    const isIncremental = shouldRunIncrementalSync(
      connectorConfig.supportsIncrementalSync,
      connector.syncMode,
      options?.fullSync,
      options?.rehydrate,
      hasTombstonedDocs,
      connector.lastSyncAt
    )
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
        accessToken = await resolveAccessToken(connector, connectorConfig, credentialUserId)
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
          deletedAt: document.deletedAt,
        })
        .from(document)
        .where(
          and(
            eq(document.connectorId, connectorId),
            isNull(document.archivedAt),
            isNotNull(document.deletedAt)
          )
        ),
      // Not filtered on deletedAt: a document can be both userExcluded and
      // tombstoned (e.g. excluded via a bulk request that raced a sync marking
      // it pending-removal). Excluding it here regardless of tombstone state
      // keeps it short-circuited in the classification loop below instead of
      // silently reappearing through the normal update/resurrect path.
      db
        .select({ externalId: document.externalId })
        .from(document)
        .where(
          and(
            eq(document.connectorId, connectorId),
            eq(document.userExcluded, true),
            isNull(document.archivedAt)
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
    /**
     * externalIds whose content was never verified as current: a hydration
     * error, a rejected write, a fulfilled-but-unusable hydration (skipped as
     * oversized, or an empty re-fetch), a listing-time skippedReason
     * short-circuit, or empty non-deferred content (`drop`) — all fall back to
     * either keeping the stored content as last-known-good or discarding the
     * listing entry outright, without ever comparing or refreshing content.
     * That's fine for an already-visible document, but for a tombstoned one it
     * means we still don't have confirmed-current content — so this excludes
     * them from resurrection below: a tombstoned document whose refresh didn't
     * actually land must stay tombstoned rather than come back visible while
     * still serving stale pre-tombstone content.
     */
    const failedExternalIds = new Set<string>()

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
          // Empty, non-deferred content is never usable. If this was a
          // reappearing tombstoned document, its content was never verified as
          // current — see failedExternalIds below.
          if (existing) failedExternalIds.add(extDoc.externalId)
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
          // A listing-time skippedReason short-circuits classification before
          // the hash comparison, so this is "kept as last-known-good", not a
          // verified-unchanged match — same as the deferred-hydration
          // equivalent above. A genuine hash match never sets skippedReason,
          // so this only fires for the short-circuited case.
          if (extDoc.skippedReason && existing) failedExternalIds.add(extDoc.externalId)
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
          accessToken = await resolveAccessToken(connector, connectorConfig, credentialUserId)
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
                // counts as unchanged rather than slipping past every result counter. Not a
                // verified refresh, though — see failedExternalIds below.
                result.docsUnchanged++
                failedExternalIds.add(op.extDoc.externalId)
              }
              return null
            }
            if (!fullDoc || !hasIndexablePayload(fullDoc)) {
              // An empty re-fetch leaves an already-indexed update as last-known-good; count
              // it as unchanged so the totals still reconcile with documents seen. Not a
              // verified refresh, though — see failedExternalIds below.
              if (op.type === 'update') {
                result.docsUnchanged++
                failedExternalIds.add(op.extDoc.externalId)
              }
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
            return { ...op, extDoc: mergeHydratedDocument(op.extDoc, fullDoc, hydratedHash) }
          })
        )

        for (let i = 0; i < hydrated.length; i++) {
          const outcome = hydrated[i]
          if (outcome.status === 'fulfilled' && outcome.value) {
            readyOps.push(outcome.value)
          } else if (outcome.status === 'rejected') {
            result.docsFailed++
            failedExternalIds.add(deferredOps[i].extDoc.externalId)
            logger.error('Failed to hydrate deferred document', {
              connectorId,
              externalId: deferredOps[i].extDoc.externalId,
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
          failedExternalIds.add(batch[j].extDoc.externalId)
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
      failedExternalIds,
      options?.fullSync
    )

    let reconcileDeletionsAllowed = shouldReconcileDeletions(
      isIncremental,
      syncContext,
      options?.fullSync
    )

    /**
     * Backstop shared by every connector: a listing that reports (almost)
     * nothing while this connector still owns a real corpus is treated as a
     * fault, not as evidence of deletion, until a consecutive sync sees the
     * same thing. Only evaluated when reconciliation would otherwise run, so
     * healthy syncs pay nothing and no existing gate is loosened.
     */
    const ownedDocCount = existingDocs.length + tombstonedDocs.length
    if (reconcileDeletionsAllowed && classifySuspectListing(seenExternalIds.size, ownedDocCount)) {
      const previousObservation = await loadPreviousListingObservation(
        connectorId,
        syncLogId,
        connector.lastSyncDocCount ?? ownedDocCount,
        !connectorConfig.supportsIncrementalSync || connector.syncMode === 'full'
      )
      const listingSafety = evaluateListingSafety(
        seenExternalIds.size,
        ownedDocCount,
        previousObservation,
        options?.fullSync
      )
      logger.warn('Suspect connector listing detected', {
        connectorId,
        connectorType: connector.connectorType,
        reason: listingSafety.reason,
        listedDocs: seenExternalIds.size,
        ownedDocs: ownedDocCount,
        liveDocs: existingDocs.length,
        tombstonedDocs: tombstonedDocs.length,
        previousListedDocs: previousObservation?.listedCount ?? null,
        previousObservationTrusted: previousObservation?.trustworthy ?? false,
        deletionReconciliation: listingSafety.blocked ? 'skipped' : 'proceeding',
        syncRunId: syncContext.syncRunId,
      })
      if (listingSafety.blocked) {
        reconcileDeletionsAllowed = false
      }
    }

    const gatedSoftDeleteIds = reconcileDeletionsAllowed ? softDeleteIds : []
    const gatedHardDeleteIds = reconcileDeletionsAllowed ? hardDeleteIds : []

    const candidateIds = [
      ...new Set([...resurrectIds, ...gatedSoftDeleteIds, ...gatedHardDeleteIds]),
    ]

    let safeResurrectIds: string[] = []
    let safeSoftDeleteIds: string[] = []
    let safeHardDeleteIds: string[] = []

    if (candidateIds.length > 0) {
      /**
       * A concurrent "delete connector, keep documents" request detaches these
       * same documents (connectorId set to NULL) under the same FOR UPDATE lock
       * the DELETE route takes on this connector row. Taking that lock here
       * serializes the two requests: whichever commits first wins, and the
       * loser's re-check below sees the up-to-date connectorId and skips any
       * document the other request already claimed — instead of resurrecting or
       * deleting a document that another request just detached (and possibly
       * already billed) as a standalone KB entry.
       */
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT 1 FROM knowledge_connector WHERE id = ${connectorId} FOR UPDATE`
        )

        const stillOwned = new Set(
          (
            await tx
              .select({ id: document.id })
              .from(document)
              .where(and(inArray(document.id, candidateIds), eq(document.connectorId, connectorId)))
          ).map((d) => d.id)
        )

        const stillOwnedResult = filterStillOwnedReconciliationIds(
          resurrectIds,
          gatedSoftDeleteIds,
          gatedHardDeleteIds,
          stillOwned
        )
        safeResurrectIds = stillOwnedResult.resurrectIds
        safeSoftDeleteIds = stillOwnedResult.softDeleteIds
        safeHardDeleteIds = stillOwnedResult.hardDeleteIds

        /**
         * A document reappearing at the source is trustworthy evidence on its
         * own — unlike absence, presence never depends on the listing being
         * complete — so resurrection runs unconditionally, even on an
         * incremental or otherwise gated sync.
         */
        if (safeResurrectIds.length > 0) {
          await tx
            .update(document)
            .set({ deletedAt: null })
            .where(inArray(document.id, safeResurrectIds))
        }
        if (safeSoftDeleteIds.length > 0) {
          await tx
            .update(document)
            .set({ deletedAt: new Date() })
            .where(inArray(document.id, safeSoftDeleteIds))
        }
      })
    }

    if (safeResurrectIds.length > 0) {
      logger.info(
        `Resurrected ${safeResurrectIds.length} documents that reappeared at the source`,
        {
          connectorId,
        }
      )
    }
    if (safeSoftDeleteIds.length > 0) {
      logger.info(
        `Marked ${safeSoftDeleteIds.length} documents pending removal — absent from source, confirming on next sync`,
        { connectorId }
      )
    }
    if (safeHardDeleteIds.length > 0) {
      // Re-verifies connectorId once more at the moment of the actual delete
      // query — the FOR UPDATE lock above only covers the window up to its
      // own commit; this closes the remaining gap between that commit and
      // this call.
      result.docsDeleted += await hardDeleteDocuments(safeHardDeleteIds, syncLogId, connectorId)
    }

    const postBatchLiveness = await checkSyncLiveness(connectorId, connector.knowledgeBaseId)
    if (postBatchLiveness.connectorDeleted) {
      throw new ConnectorDeletedException(connectorId)
    }
    if (postBatchLiveness.knowledgeBaseDeleted) {
      throw new Error(`Knowledge base ${connector.knowledgeBaseId} was deleted during sync`)
    }

    /**
     * Reclaims documents this connector left unfinished: a terminated attempt, a
     * dispatch that never produced a run, or a run abandoned mid-processing.
     *
     * The query narrows to this connector's non-terminal documents inside the
     * `RETRY_WINDOW_DAYS` window and excludes anything created by this sync;
     * {@link isStuckDocumentSweepEligible} then makes the per-document decision,
     * so the age rules live in one place rather than being split between SQL and
     * TypeScript. Skipped (oversized) documents are recorded as content-less
     * `failed` rows with no storage key and can never be reprocessed, so they are
     * excluded outright.
     */
    const sweepEvaluatedAt = new Date()
    const sweepCandidates = await db
      .select({
        id: document.id,
        fileUrl: document.fileUrl,
        filename: document.filename,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
        processingStatus: document.processingStatus,
        processingQueuedAt: document.processingQueuedAt,
        processingStartedAt: document.processingStartedAt,
        processingCompletedAt: document.processingCompletedAt,
        uploadedAt: document.uploadedAt,
      })
      .from(document)
      .where(
        and(
          eq(document.connectorId, connectorId),
          inArray(document.processingStatus, ['pending', 'failed', 'processing']),
          lt(document.uploadedAt, syncStartedAt),
          gt(document.uploadedAt, retryCutoff),
          eq(document.userExcluded, false),
          isNotNull(document.storageKey),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )
    const stuckDocs = sweepCandidates.filter((doc) =>
      isStuckDocumentSweepEligible(doc, sweepEvaluatedAt)
    )

    if (stuckDocs.length > 0) {
      logger.info(`Retrying ${stuckDocs.length} stuck documents`, { connectorId })
      try {
        const stuckDocIds = stuckDocs.map((doc) => doc.id)
        let retryDocs: typeof stuckDocs = []

        /**
         * Takes the same `knowledge_connector` FOR UPDATE lock the DELETE route
         * takes before nulling connectorId on detached documents, so the two
         * requests serialize instead of racing — a plain re-SELECT only
         * narrows the window between the ownership check and these writes, it
         * never closes it, since a concurrent detach can still commit in
         * between. Embedding cleanup and the processing-state reset happen
         * inside the same locked transaction so a document already claimed by
         * a detach never gets its embeddings wiped or is reprocessed as if
         * still connector-owned.
         */
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT 1 FROM knowledge_connector WHERE id = ${connectorId} FOR UPDATE`
          )

          const stillOwnedIds = new Set(
            (
              await tx
                .select({ id: document.id })
                .from(document)
                .where(
                  and(inArray(document.id, stuckDocIds), eq(document.connectorId, connectorId))
                )
            ).map((d) => d.id)
          )
          retryDocs = stuckDocs.filter((doc) => stillOwnedIds.has(doc.id))

          if (retryDocs.length > 0) {
            const retryDocIds = retryDocs.map((doc) => doc.id)

            await tx.delete(embedding).where(inArray(embedding.documentId, retryDocIds))

            await tx
              .update(document)
              .set({
                processingStatus: 'pending',
                /**
                 * Records when this re-dispatch was queued, so a later sweep can
                 * tell a document still waiting for a worker from one whose
                 * dispatch was lost. See {@link isStuckDocumentSweepEligible}.
                 */
                processingQueuedAt: sweepEvaluatedAt,
                processingStartedAt: null,
                processingCompletedAt: null,
                processingError: null,
                chunkCount: 0,
                tokenCount: 0,
                characterCount: 0,
              })
              .where(inArray(document.id, retryDocIds))
          }
        })

        if (retryDocs.length > 0) {
          await processDocumentsWithQueue(
            retryDocs.map((doc) => ({
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
        }
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
          syncLogId,
          connectorId
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
async function updateDocument(
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
    .where(eq(document.id, existingDocId))
    .limit(1)
  const oldFileUrl = existingRows[0]?.fileUrl

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
          uploadedAt: new Date(),
          // A tombstoned document reappearing with changed content is resurrected
          // in the same write as its content update — otherwise reconciliation's
          // separate resurrect step would clear deletedAt while this update, gated
          // on deletedAt IS NULL, rejects the row and leaves stale content active.
          deletedAt: null,
        })
        .where(
          and(
            eq(document.id, existingDocId),
            // A concurrent "delete connector, keep documents" request can null out
            // connectorId between this sync's liveness check and this write. Without
            // this check, that now-standalone document would still match on id alone
            // and get overwritten with connector-sourced content post-detachment.
            eq(document.connectorId, connectorId),
            isNull(document.archivedAt)
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
    filename: artifact.fileName,
    fileUrl,
    fileSize: artifact.bytes.length,
    mimeType: artifact.mimeType,
  }
}
