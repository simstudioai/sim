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
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { env, envNumber } from '@/lib/core/config/env'
import type { ConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import { SyncLockLostException, type SyncRunLease } from '@/lib/knowledge/connectors/sync-lock'
import {
  addDocument,
  type KnowledgeBaseOwner,
  persistSkippedDocuments,
  persistSkippedRetryHashes,
  updateDocument,
} from '@/lib/knowledge/connectors/sync-persistence'
import { DOCUMENT_PROCESSING_STALE_THRESHOLD_MS } from '@/lib/knowledge/documents/processing-timeouts.server'
import type { DocumentData } from '@/lib/knowledge/documents/service'
import { isTriggerAvailable, processDocumentsWithQueue } from '@/lib/knowledge/documents/service'
import {
  type DocumentProcessingStatus,
  isDocumentProcessingStatus,
  MAX_PROCESSING_ATTEMPTS,
  QUEUED_DISPATCH_GRACE_MS,
} from '@/lib/knowledge/documents/types'
import { getRetryAfterMs, isRateLimitError } from '@/lib/knowledge/documents/utils'
import type {
  ConnectorConfig,
  ExternalChange,
  ExternalDocument,
  SyncResult,
} from '@/connectors/types'
import { hasIndexablePayload } from '@/connectors/utils'

const logger = createLogger('ConnectorSyncPrimitives')

export class ConnectorDeletedException extends Error {
  constructor(connectorId: string) {
    super(`Connector ${connectorId} was deleted during sync`)
    this.name = 'ConnectorDeletedException'
  }
}

const SYNC_BATCH_SIZE = 5
/** Unknown deferred downloads run alone; actual connector files can reach this budget. */
const DEFAULT_OP_SIZE_BYTES = 64 * 1024 * 1024
/**
 * Max summed source bytes hydrated/uploaded concurrently within a batch. Each
 * in-flight file materializes as a content string plus an upload buffer, so this
 * bounds peak worker memory: a few large files near the per-file cap are processed
 * in smaller sub-chunks instead of all at once, while small files still process up
 * to SYNC_BATCH_SIZE at a time.
 */
const CONTENT_INFLIGHT_BUDGET_BYTES = 64 * 1024 * 1024
const MAX_PAGES = 500
/** Bounds a provider page or a single change-feed drain; full listings resume across workers. */
export const CONNECTOR_SYNC_MAX_CORPUS_DOCUMENTS = 50_000

export const CONNECTOR_SYNC_MAX_SOURCE_PAYLOAD_BYTES = 256 * 1024 * 1024

/**
 * Queue descriptors per submission, independent of the source hydration byte budget.
 * Inline processing keeps the smaller hydration batches so downloads and OCR stay bounded.
 * Stuck retries also yield between submissions to renew the connector lease.
 */
const PROCESSING_DISPATCH_BATCH_SIZE = 25

/**
 * Bounds each sync's contribution to the shared processing queue. Oldest eligible
 * documents drain first; the remaining backlog stays eligible for subsequent syncs.
 */
export const STUCK_RETRY_MAX_CANDIDATES_PER_SYNC = 200

/**
 * Concurrent `knowledge-process-document` runs, shared by every workspace.
 *
 * Read from the same env var the task itself is configured with rather than
 * restated, so the drain estimate below cannot describe a queue depth the
 * deployment does not actually run.
 */
const PROCESSING_QUEUE_CONCURRENCY = envNumber(env.KB_CONFIG_CONCURRENCY_LIMIT, 20)

export class ConnectorSyncCapacityError extends Error {}

export function sourcePageFitsSyncWorkingSet(rowsAlreadyLoaded: number, pageRows: number): boolean {
  return rowsAlreadyLoaded + pageRows <= CONNECTOR_SYNC_MAX_CORPUS_DOCUMENTS
}

function retainedExternalDocumentBytes(doc: ExternalDocument): number {
  let bytes = Buffer.byteLength(doc.externalId) + Buffer.byteLength(doc.title)
  bytes += Buffer.byteLength(doc.content ?? '')
  bytes += Buffer.byteLength(doc.sourceUrl ?? '')
  bytes += Buffer.byteLength(doc.contentHash ?? '')
  if (doc.sourceFile?.bytes) bytes += doc.sourceFile.bytes.byteLength
  try {
    bytes += Buffer.byteLength(JSON.stringify(doc.metadata ?? {}))
  } catch {
    bytes += DEFAULT_OP_SIZE_BYTES
  }
  return bytes
}

/** Fails listing before the engine retains an unbounded inline-content corpus. */
export function addSourcePagePayloadBytes(
  retainedBytes: number,
  documents: ExternalDocument[]
): number {
  let nextBytes = retainedBytes
  for (const doc of documents) {
    nextBytes += retainedExternalDocumentBytes(doc)
    if (nextBytes > CONNECTOR_SYNC_MAX_SOURCE_PAYLOAD_BYTES) {
      throw new ConnectorSyncCapacityError(
        `Connector source listing exceeds the safe retained-payload limit of ${CONNECTOR_SYNC_MAX_SOURCE_PAYLOAD_BYTES.toLocaleString()} bytes. Use a narrower source scope or a deferred-content connector.`
      )
    }
  }
  return nextBytes
}

/** Reclaim must wait beyond the configured processing/retry lifetime to avoid deleting live work. */
const STALE_PROCESSING_MINUTES = DOCUMENT_PROCESSING_STALE_THRESHOLD_MS / (60 * 1000)
export const RETRY_WINDOW_DAYS = 7

/**
 * Processing states the stuck-document sweep may reclaim from.
 *
 * One constant used by BOTH the candidate SELECT and the reset UPDATE. The
 * UPDATE has to re-assert what the SELECT filtered on — the ownership re-check
 * between them covers `connectorId` only, so a document that completed in that
 * window would otherwise be reset and have its embeddings deleted. Sharing the
 * list means the two cannot drift into disagreeing about what is reclaimable.
 */
export const SWEEPABLE_PROCESSING_STATUSES = ['pending', 'failed', 'processing'] as const

/** The processing state the stuck-document sweep decides on, one row at a time. */
export interface StuckDocumentSweepCandidate {
  processingStatus: DocumentProcessingStatus
  processingQueuedAt: Date | null
  processingStartedAt: Date | null
  processingDeferredUntil: Date | null
  processingCompletedAt: Date | null
  uploadedAt: Date
}

/**
 * Pending work may wait behind other workspaces; failed work may still have a queued retry.
 * Both need queue grace, measured from the latest attempt, before reclaim. Legacy unstamped
 * rows fall back to uploadedAt. Running work instead uses the configured processing lifetime.
 *
 * Timing only controls retry eligibility: queue stamps fence superseded attempts from
 * claiming or billing documents after the sweep installs a replacement generation.
 */
export function isStuckDocumentSweepEligible(doc: StuckDocumentSweepCandidate, now: Date): boolean {
  switch (doc.processingStatus) {
    case 'failed': {
      const lastAttemptEndedAt =
        doc.processingCompletedAt ?? doc.processingQueuedAt ?? doc.uploadedAt
      return now.getTime() - lastAttemptEndedAt.getTime() > QUEUED_DISPATCH_GRACE_MS
    }
    case 'pending': {
      if (doc.processingDeferredUntil) {
        return now.getTime() - doc.processingDeferredUntil.getTime() > QUEUED_DISPATCH_GRACE_MS
      }
      const queuedAt = doc.processingQueuedAt ?? doc.uploadedAt
      return now.getTime() - queuedAt.getTime() > QUEUED_DISPATCH_GRACE_MS
    }
    case 'processing': {
      if (!doc.processingStartedAt) return true
      return (
        now.getTime() - doc.processingStartedAt.getTime() > STALE_PROCESSING_MINUTES * 60 * 1000
      )
    }
    /**
     * No `default`: a status added to DocumentProcessingStatus must fail
     * type-check here rather than silently reading as "not eligible".
     */
    case 'completed':
      return false
  }
}

export function stuckDocumentSweepAgeAnchor(doc: StuckDocumentSweepCandidate): Date {
  switch (doc.processingStatus) {
    case 'failed':
      return doc.processingCompletedAt ?? doc.processingQueuedAt ?? doc.uploadedAt
    case 'pending':
      return doc.processingDeferredUntil ?? doc.processingQueuedAt ?? doc.uploadedAt
    case 'processing':
      return doc.processingStartedAt ?? new Date(0)
    case 'completed':
      return doc.uploadedAt
  }
}

export function selectStuckDocumentSweepCandidates<
  T extends StuckDocumentSweepCandidate & { id: string },
>(documents: T[], now: Date, limit = STUCK_RETRY_MAX_CANDIDATES_PER_SYNC): T[] {
  return documents
    .filter((doc) => isStuckDocumentSweepEligible(doc, now))
    .sort((left, right) => {
      const ageOrder =
        stuckDocumentSweepAgeAnchor(left).getTime() - stuckDocumentSweepAgeAnchor(right).getTime()
      return ageOrder || left.id.localeCompare(right.id)
    })
    .slice(0, limit)
}

export type DocOp =
  | { type: 'add'; extDoc: ExternalDocument }
  | { type: 'update'; existingId: string; extDoc: ExternalDocument }
  | { type: 'skip'; existingId?: string; extDoc: ExternalDocument }

type DocClassification =
  | { type: 'add' }
  | { type: 'update'; existingId: string }
  | { type: 'skip'; existingId?: string }
  | { type: 'unchanged' }
  | { type: 'drop' }

export function shouldReplaceExistingWithSkippedDocument(
  existing: { storageKey?: string | null },
  skipped: Pick<ExternalDocument, 'skippedExistingDisposition'>
): boolean {
  return existing.storageKey === null || skipped.skippedExistingDisposition === 'replace'
}

/**
 * Decides what a listed external document becomes during reconciliation.
 *
 * - `skip`: connector flagged it (e.g. too large) and it is not already indexed —
 *   record a visible `failed` document instead of dropping it silently. Existing
 *   content stays last-known-good unless the connector marks the skip authoritative.
 * - `drop`: empty, non-deferred content that cannot be indexed.
 * - `add` / `update` / `unchanged`: normal content reconciliation by content hash.
 * - A deferred listing rehydrates an existing content-less placeholder unless
 *   the connector explicitly guarantees its skip recovers only on source changes.
 *   Source failures and explicit rehydration always retry.
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
    | 'content'
    | 'sourceFile'
    | 'contentDeferred'
    | 'contentHash'
    | 'skippedReason'
    | 'skippedExistingDisposition'
    | 'skippedRetryPolicy'
  >,
  existing: { id: string; contentHash: string | null; storageKey?: string | null } | undefined,
  forceRehydrate = false
): DocClassification {
  if (extDoc.skippedReason) {
    if (!existing) return { type: 'skip' }
    return shouldReplaceExistingWithSkippedDocument(existing, extDoc)
      ? { type: 'skip', existingId: existing.id }
      : { type: 'unchanged' }
  }
  if (!hasIndexablePayload(extDoc) && !extDoc.contentDeferred) {
    return { type: 'drop' }
  }
  if (!existing) {
    return { type: 'add' }
  }
  if (
    existing.storageKey === null &&
    extDoc.contentDeferred &&
    extDoc.skippedRetryPolicy !== 'source-change'
  ) {
    return { type: 'update', existingId: existing.id }
  }
  if (existing.contentHash === null || existing.contentHash !== extDoc.contentHash) {
    return { type: 'update', existingId: existing.id }
  }
  if (forceRehydrate && extDoc.contentDeferred) {
    return { type: 'update', existingId: existing.id }
  }
  return { type: 'unchanged' }
}

/**
 * Hydration must replace metadata as well as bytes: a deferred text stub can become
 * a binary source file, whose MIME type and filename determine parser and OCR routing.
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

/**
 * Merges a hydration-time skip marker onto its listing stub.
 *
 * A skipped hydration did not verify indexable content, so its provider-specific
 * fallback hash cannot supersede the listing hash used by the next sync's change
 * classification. A source-change retry policy instead requires the hydrated
 * version: a listing/hydration race must not cache a skip for an unverified version.
 * A connector can explicitly provide
 * `skippedRetryContentHash` when the skip must be retried independently of that
 * metadata, such as a Notion nested block whose access changes without editing
 * its parent page.
 */
export function mergeHydratedSkippedDocument(
  stub: ExternalDocument,
  hydrated: ExternalDocument
): ExternalDocument {
  return {
    ...stub,
    content: '',
    contentHash:
      hydrated.skippedRetryContentHash ??
      (stub.skippedRetryPolicy === 'source-change' ? hydrated.contentHash : stub.contentHash),
    contentDeferred: false,
    skippedReason: hydrated.skippedReason,
    skippedExistingDisposition: hydrated.skippedExistingDisposition,
    metadata: { ...stub.metadata, ...hydrated.metadata },
  }
}

/**
 * A listed deferred document is known to exist at listing time. A null hydration
 * is therefore ambiguous provider failure, not authoritative deletion: treating
 * it as a successful drop can advance an incremental watermark past a document
 * that merely became inaccessible.
 */
export function requireHydratedListedDocument(
  document: ExternalDocument | null,
  externalId: string
): ExternalDocument {
  if (!document) {
    throw new Error(`Connector returned no content for listed document ${externalId}`)
  }
  return document
}

/**
 * Records a source update that was observed but could not be verified or
 * persisted. The stored document remains last-known-good, while `docsFailed`
 * prevents an incremental watermark from advancing past the consumed change.
 */
export function recordUnverifiedExistingRefresh(
  result: Pick<SyncResult, 'docsFailed'>,
  failedExternalIds: Set<string>,
  externalId: string
): void {
  if (failedExternalIds.has(externalId)) return
  failedExternalIds.add(externalId)
  result.docsFailed++
}

/** Actual retained bytes when available, otherwise a conservative deferred estimate. */
function estimateOpSizeBytes(op: DocOp): number {
  /**
   * Skip ops load no content (just a row insert), so they do not count against the
   * in-flight content budget.
   */
  if (op.type === 'skip') return 0
  if (op.extDoc.sourceFile?.bytes) return op.extDoc.sourceFile.bytes.byteLength
  if (op.extDoc.content) return Buffer.byteLength(op.extDoc.content)
  const size = op.extDoc.estimatedBytes ?? op.extDoc.metadata?.fileSize ?? op.extDoc.metadata?.size
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

/**
 * Single-roundtrip check that this sync's targets still exist.
 *
 * Named for presence rather than liveness deliberately: this file uses
 * "liveness" in its distributed-systems sense — a run proving it is still
 * working, via {@link heartbeatSyncLock} — and reusing the word for a row
 * existence check conflated two unrelated questions three lines apart.
 */
export async function checkSyncTargetPresence(
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
 * A suspect listing is only acted on after a consecutive sync observes the same
 * thing, so a single transient upstream fault can never remove
 * documents — not even reversibly, since a soft delete hides them from search
 * immediately. A genuinely emptied source keeps reconciling: its second sync
 * corroborates the first and tombstones everything, and a later sync — once the
 * tombstoned set is again absent — completes the two-strike purge, subject to
 * the reconciliation deletion cap, which withholds any generation whose
 * deletion count exceeds the per-sync blast-radius cap.
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
 * Operator-facing explanation of a held reconciliation pass.
 *
 * Stored on `knowledgeConnector.lastSyncError` because a hold is otherwise
 * invisible: the sync completes normally and an operator sees an ordinary green
 * run while source-removed documents stay indexed. Names the forced full sync,
 * which is the documented way to apply the removals once the source is verified.
 */
export function buildReconciliationHoldNotice(
  withheld: number,
  cap: number,
  ownedDocCount: number,
  softHeld: boolean,
  hardHeld: boolean
): string {
  /**
   * Stated per held generation. A hard-only hold withholds documents that a
   * previous sync already tombstoned, so they have been invisible since then —
   * telling the operator they are "still indexed" would be false.
   */
  const consequence =
    softHeld && hardHeld
      ? 'Documents removed at the source are still indexed, and documents already pending removal were not purged.'
      : softHeld
        ? 'Documents removed at the source are still indexed.'
        : 'Documents already pending removal were not purged; they stay hidden from search either way.'

  return (
    `Withheld ${withheld} document removal(s) — more than the ${cap} allowed per generation ` +
    `in one sync of ${ownedDocCount} documents. ${consequence} ` +
    'Check the source is returning its full contents, then run a full sync to apply the removals.'
  )
}

/**
 * The document count to attribute to the previous sync when reconstructing its
 * listing.
 *
 * `lastSyncDocCount` counts only *visible* documents, so after a pass that
 * tombstoned a corpus it collapses toward 0 — and an owned count of 0 can never
 * be classified as suspect, so corroboration silently became impossible and the
 * two-strike purge jammed shut. Taking the larger of the recorded count and what
 * the connector owns right now (tombstones included) restores the intent: the
 * previous run is judged against a corpus at least as large as the one still
 * present.
 */
export function resolvePreviousOwnedCount(
  lastSyncDocCount: number | null | undefined,
  ownedDocCount: number
): number {
  return Math.max(lastSyncDocCount ?? 0, ownedDocCount)
}

/**
 * Fraction of a connector's owned documents that a single reconciliation pass
 * may remove before the pass is held.
 *
 * {@link SUSPECT_COLLAPSE_MAX_RATIO} only questions a listing that returns under
 * 10% of the corpus, which leaves every partial-outage shape between 10% and
 * 100% completely unguarded: a source that serves half its documents produces a
 * listing that looks perfectly healthy to every shape guard, tombstones the
 * missing half, and hard-deletes it on the next pass. 25% sits well above
 * ordinary housekeeping (a quarter of a corpus removed between two syncs is
 * already extraordinary) and well below the outage shapes seen in the wild.
 */
const RECONCILIATION_DELETE_MAX_RATIO = 0.25

/**
 * Deletions always permitted regardless of ratio.
 *
 * The ratio is meaningless on a small corpus for the same reason
 * {@link SUSPECT_COLLAPSE_MIN_OWNED_DOCS} exists — removing 20 of 40 documents
 * is ordinary editing — and a floor below the collapse guard's own 50-document
 * threshold keeps the cap from being the binding constraint on corpora that
 * guard was written to ignore.
 */
const RECONCILIATION_DELETE_MIN_ABSOLUTE = 25

/** Maximum number of documents one reconciliation pass may remove. */
export function resolveReconciliationDeleteCap(ownedDocCount: number): number {
  return Math.max(
    RECONCILIATION_DELETE_MIN_ABSOLUTE,
    Math.floor(Math.max(ownedDocCount, 0) * RECONCILIATION_DELETE_MAX_RATIO)
  )
}

/** The complete cycle count is authoritative; older logs conservatively reconstruct it from counters. */
export async function loadPreviousListingObservation(
  connectorId: string,
  currentSyncLogId: string,
  previousOwnedCount: number
): Promise<PreviousListingObservation | null> {
  const rows = await db
    .select({
      listedCount: knowledgeConnectorSyncLog.listedCount,
      docsAdded: knowledgeConnectorSyncLog.docsAdded,
      docsUpdated: knowledgeConnectorSyncLog.docsUpdated,
      docsUnchanged: knowledgeConnectorSyncLog.docsUnchanged,
      docsSkipped: knowledgeConnectorSyncLog.docsSkipped,
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
      previous.listedCount ??
      previous.docsAdded +
        previous.docsUpdated +
        previous.docsUnchanged +
        previous.docsSkipped +
        previous.docsFailed,
    ownedCount: previousOwnedCount,
    trustworthy: true,
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

/** What a change-feed pass needs from the engine that runs it. */
export interface ChangeFeedPassInput {
  connectorId: string
  connectorConfig: { listChanges: NonNullable<ConnectorConfig['listChanges']> }
  sourceConfig: Record<string, unknown>
  syncContext: Record<string, unknown>
  /** Where the feed was last left. */
  cursor: string
  beforePage: () => Promise<void>
  getAccessToken: (pageNum: number) => Promise<string>
  deadlineAt?: number
  maxPages?: number
}

export interface ChangeFeedPassResult {
  /** The latest stub of every item the feed reported as present, in feed order. */
  upserts: ExternalDocument[]
  /** Items whose last word from the feed was a removal. */
  removedExternalIds: string[]
  /** Where the next read resumes: past every page this pass consumed. */
  cursor: string
  /** False when pagination stopped before the feed was drained. */
  exhausted: boolean
}

/**
 * Reads a change feed to exhaustion, the page cap, or the deadline. Each item
 * keeps only its last change, so something removed and re-shared inside one
 * pass reads as present. The returned cursor sits past every page that was
 * read, so an interrupted pass never replays what it already applied.
 */
export async function runChangeFeedPass(input: ChangeFeedPassInput): Promise<ChangeFeedPassResult> {
  const { connectorId, connectorConfig, sourceConfig, syncContext } = input
  const maxPages = input.maxPages ?? MAX_PAGES
  const latest = new Map<string, ExternalChange>()
  let retainedSourcePayloadBytes = 0
  let cursor = input.cursor
  let hasMore = true

  for (let pageNum = 0; hasMore && pageNum < maxPages; pageNum++) {
    await input.beforePage()

    if (input.deadlineAt !== undefined && Date.now() >= input.deadlineAt) {
      break
    }

    const accessToken = await input.getAccessToken(pageNum)
    const page = await connectorConfig.listChanges(accessToken, sourceConfig, cursor, syncContext)

    const upserts: ExternalDocument[] = []
    for (const change of page.changes) {
      if (change.kind === 'upsert') upserts.push(change.document)
    }
    if (!page.nextCursor || (page.hasMore && page.nextCursor === cursor)) {
      throw new Error('Connector change pagination did not advance')
    }
    if (!sourcePageFitsSyncWorkingSet(latest.size, page.changes.length)) {
      if (latest.size === 0) {
        throw new ConnectorSyncCapacityError(
          `Connector ${connectorId} change feed exceeds the safe per-corpus limit of ${CONNECTOR_SYNC_MAX_CORPUS_DOCUMENTS.toLocaleString()} documents. Narrow the configured source scope or set a connector document limit before syncing again.`
        )
      }
      break
    }
    try {
      retainedSourcePayloadBytes = addSourcePagePayloadBytes(retainedSourcePayloadBytes, upserts)
    } catch (error) {
      if (!(error instanceof ConnectorSyncCapacityError) || latest.size === 0) throw error
      break
    }
    for (const change of page.changes) latest.set(change.externalId, change)

    cursor = page.nextCursor
    hasMore = page.hasMore
  }

  const result: ChangeFeedPassResult = {
    upserts: [],
    removedExternalIds: [],
    cursor,
    exhausted: !hasMore,
  }
  for (const change of latest.values()) {
    if (change.kind === 'upsert') result.upserts.push(change.document)
    else result.removedExternalIds.push(change.externalId)
  }
  return result
}

interface OwnedDocument {
  id: string
  externalId: string | null
  contentHash: string | null
  storageKey: string | null
  userExcluded: boolean
  sourceSeenAt: Date | null
}

interface OwnedCorpus {
  excludedExternalIds: Set<string>
  priorByExternalId: Map<string, OwnedDocument>
}

/** Loads only the identities in one source page, regardless of the total corpus size. */
export async function loadPageCorpus(
  connectorId: string,
  externalIds: readonly string[]
): Promise<OwnedCorpus> {
  const corpus: OwnedCorpus = {
    excludedExternalIds: new Set(),
    priorByExternalId: new Map(),
  }
  const ids = [...new Set(externalIds)]
  for (let offset = 0; offset < ids.length; offset += 500) {
    const rows = await db
      .select({
        id: document.id,
        externalId: document.externalId,
        contentHash: document.contentHash,
        storageKey: document.storageKey,
        userExcluded: document.userExcluded,
        sourceSeenAt: document.sourceSeenAt,
      })
      .from(document)
      .where(
        and(
          eq(document.connectorId, connectorId),
          inArray(document.externalId, ids.slice(offset, offset + 500)),
          isNull(document.archivedAt)
        )
      )
      .limit(501)
    if (rows.length > 500)
      throw new ConnectorSyncCapacityError('Connector has duplicate source identities')
    for (const row of rows) {
      if (!row.externalId) continue
      corpus.priorByExternalId.set(row.externalId, row)
      if (row.userExcluded) corpus.excludedExternalIds.add(row.externalId)
    }
  }
  return corpus
}

/** The per-run bookkeeping the classification and persistence stages share. */
export interface SyncRunState {
  result: SyncResult
  /** Every external id the listing produced, deduplicated at first sight. */
  seenExternalIds: Set<string>
  /** Failed source refreshes cannot resurrect tombstones or authorize retained bytes. */
  failedExternalIds: Set<string>
}

/** Fresh bookkeeping for one provider page. */
export function createSyncRunState(result: SyncResult): SyncRunState {
  return { result, seenExternalIds: new Set<string>(), failedExternalIds: new Set<string>() }
}

/**
 * Turns the listing into the operations that need content work, counting the
 * documents that need none. Duplicated external ids are seen once; excluded
 * documents count as unchanged without ever being compared.
 */
export function classifyListing(input: {
  externalDocs: ExternalDocument[]
  corpus: OwnedCorpus
  forceRehydrate: boolean
  state: SyncRunState
}): DocOp[] {
  const { externalDocs, corpus, forceRehydrate } = input
  const { result, seenExternalIds, failedExternalIds } = input.state

  const pendingOps: DocOp[] = []
  for (const extDoc of externalDocs) {
    if (seenExternalIds.has(extDoc.externalId)) continue
    seenExternalIds.add(extDoc.externalId)

    if (corpus.excludedExternalIds.has(extDoc.externalId)) {
      result.docsUnchanged++
      continue
    }

    const existing = corpus.priorByExternalId.get(extDoc.externalId)
    const classification = classifyExternalDoc(extDoc, existing, forceRehydrate)

    switch (classification.type) {
      case 'skip':
        pendingOps.push({
          type: 'skip',
          existingId: classification.existingId,
          extDoc,
        })
        break
      case 'drop':
        recordUnverifiedExistingRefresh(result, failedExternalIds, extDoc.externalId)
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
        /** skippedReason bypasses the hash comparison, so unchanged content remains unverified. */
        if (extDoc.skippedReason && existing) {
          recordUnverifiedExistingRefresh(result, failedExternalIds, extDoc.externalId)
        } else {
          result.docsUnchanged++
        }
        break
    }
  }
  return pendingOps
}

/** How deferred content is fetched; each engine supplies the identity it fetches with. */
export interface DocOpHydration {
  /** Runs once per batch that has deferred documents, before any of them is fetched. */
  beforeHydration?: () => Promise<void>
  getDocument: (externalId: string) => Promise<ExternalDocument | null>
}

/** What the persistence stage needs from the engine that runs it. */
export interface ProcessDocOpsInput {
  connectorId: string
  connector: { knowledgeBaseId: string; connectorType: string }
  sourceConfig: Record<string, unknown>
  kbOwner: KnowledgeBaseOwner
  billingAttribution: BillingAttributionSnapshot
  pendingOps: DocOp[]
  corpus: Pick<OwnedCorpus, 'priorByExternalId'>
  forceRehydrate: boolean
  state: SyncRunState
  hydration: DocOpHydration
  lease: Pick<SyncRunLease, 'beatIfDue' | 'beatLive' | 'stillHeld'>
  /** Who may read the documents this pass writes. */
  documentAccess: ConnectorAccessMode
  /** Yield between batches; one batch always advances an already fetched page. */
  deadlineAt?: number
  onBatchComplete?: (documents: ExternalDocument[]) => Promise<void>
}

/**
 * Hydrates, stores, and dispatches the pending operations in batches bounded
 * by both count and in-flight content bytes. Every failure is counted on the
 * run state rather than thrown, except a provider rate limit, which ends the
 * run so the connector backs off, and a lost lease, which ends it so no
 * further write lands beside the replacement run's.
 */
export async function processDocOps(input: ProcessDocOpsInput): Promise<boolean> {
  const {
    connectorId,
    connector,
    sourceConfig,
    kbOwner,
    billingAttribution,
    forceRehydrate,
    documentAccess,
  } = input
  const { priorByExternalId } = input.corpus
  const { result, failedExternalIds } = input.state

  const pendingDispatch: DocumentData[] = []
  const bufferDispatch = isTriggerAvailable()
  const flushDispatch = async () => {
    if (pendingDispatch.length === 0) return
    const documents = pendingDispatch.splice(0)
    result.processingDispatch.requested += documents.length
    try {
      const dispatch = await processDocumentsWithQueue(
        documents,
        connector.knowledgeBaseId,
        {},
        generateId(),
        billingAttribution,
        { connectorId, stillHeld: input.lease.stillHeld }
      )
      result.processingDispatch.accepted += dispatch.accepted
      result.processingDispatch.failed += dispatch.failed
    } catch (error) {
      if (error instanceof SyncLockLostException) throw error
      result.processingDispatch.failed += documents.length
      logger.warn('Failed to enqueue documents for processing — will retry on next sync', {
        connectorId,
        count: documents.length,
        error: toError(error).message,
      })
    }
  }

  const batches = chunkOpsByByteBudget(
    input.pendingOps,
    CONTENT_INFLIGHT_BUDGET_BYTES,
    SYNC_BATCH_SIZE
  )
  try {
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      if (batchIndex > 0 && input.deadlineAt !== undefined && Date.now() >= input.deadlineAt) {
        return false
      }
      const rawBatch = batches[batchIndex]
      const presence = await checkSyncTargetPresence(connectorId, connector.knowledgeBaseId)
      if (presence.connectorDeleted) {
        throw new ConnectorDeletedException(connectorId)
      }
      if (presence.knowledgeBaseDeleted) {
        throw new Error(`Knowledge base ${connector.knowledgeBaseId} was deleted during sync`)
      }

      /**
       * After liveness: a deleted connector must raise ConnectorDeletedException
       * and run its cleanup, not be reported as a lost lock.
       */
      await input.lease.beatIfDue()

      const skipOps = rawBatch.filter((op) => op.type === 'skip')
      const skippedRetryHashUpdates: Array<{
        existingId: string
        externalId: string
        contentHash: string
      }> = []

      const contentOps = rawBatch.filter((op) => op.type !== 'skip')
      const deferredOps = contentOps.filter((op) => op.extDoc.contentDeferred)
      const readyOps = contentOps.filter((op) => !op.extDoc.contentDeferred)
      let hydrationDeferral: unknown
      const deferredExternalIds = new Set<string>()

      if (deferredOps.length > 0) {
        await input.hydration.beforeHydration?.()

        const hydrated = await Promise.allSettled(
          deferredOps.map(async (op) => {
            const fullDoc = requireHydratedListedDocument(
              await input.hydration.getDocument(op.extDoc.externalId),
              op.extDoc.externalId
            )
            /**
             * A connector may only learn a file is too large at fetch time (its
             * listing has no size). Surface that as a failed row for new files; keep
             * already-indexed files as last-known-good rather than downgrading them.
             */
            if (fullDoc?.skippedReason) {
              if (op.type === 'add') {
                skipOps.push({
                  type: 'skip',
                  extDoc: mergeHydratedSkippedDocument(op.extDoc, fullDoc),
                })
              } else if (op.type === 'update') {
                const existing = priorByExternalId.get(op.extDoc.externalId)
                if (existing && shouldReplaceExistingWithSkippedDocument(existing, fullDoc)) {
                  skipOps.push({
                    type: 'skip',
                    existingId: op.existingId,
                    extDoc: mergeHydratedSkippedDocument(op.extDoc, fullDoc),
                  })
                } else {
                  if (fullDoc.skippedRetryContentHash) {
                    skippedRetryHashUpdates.push({
                      existingId: op.existingId,
                      externalId: op.extDoc.externalId,
                      contentHash: fullDoc.skippedRetryContentHash,
                    })
                  }
                  /** Preserve last-known-good content and replay the unverified source change. */
                  recordUnverifiedExistingRefresh(result, failedExternalIds, op.extDoc.externalId)
                }
              }
              return null
            }
            if (!hasIndexablePayload(fullDoc)) {
              /** An empty refresh cannot replace or advance past last-known-good content. */
              recordUnverifiedExistingRefresh(result, failedExternalIds, op.extDoc.externalId)
              return null
            }
            const hydratedHash = fullDoc.contentHash ?? op.extDoc.contentHash
            const existing = priorByExternalId.get(op.extDoc.externalId)
            /**
             * Normally an update whose hydrated hash matches the stored hash is a
             * no-op when stored content exists. Content-less placeholders must
             * index newly recovered text even if the source version is unchanged.
             * Forced rehydration also refreshes rendered dependencies whose changes
             * are not represented by the parent version hash.
             */
            if (
              op.type === 'update' &&
              !forceRehydrate &&
              existing?.storageKey !== null &&
              existing?.contentHash === hydratedHash
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
            if (isRateLimitError(outcome.reason)) {
              deferredExternalIds.add(deferredOps[i].extDoc.externalId)
              if (
                hydrationDeferral === undefined ||
                (getRetryAfterMs(outcome.reason) ?? 0) > (getRetryAfterMs(hydrationDeferral) ?? 0)
              ) {
                hydrationDeferral = outcome.reason
              }
              continue
            }
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

      /**
       * Hydration above may have outlasted the lease. Nothing from this batch is
       * written until the run proves it still owns the connector, and every
       * write below proves it again inside its own transaction, so a run that
       * was replaced meanwhile cannot land stale content or queue processing
       * over the replacement's.
       */
      await input.lease.beatLive()

      if (skippedRetryHashUpdates.length > 0) {
        try {
          const missedExternalIds = await persistSkippedRetryHashes(
            connector.knowledgeBaseId,
            connectorId,
            skippedRetryHashUpdates,
            input.lease
          )
          if (missedExternalIds.length > 0) {
            logger.warn('Skipped retry hashes were not persisted for detached documents', {
              connectorId,
              externalIds: missedExternalIds,
            })
          }
        } catch (error) {
          logger.error('Failed to persist skipped document retry hashes', {
            connectorId,
            count: skippedRetryHashUpdates.length,
            error: toError(error).message,
          })
          throw error
        }
      }

      if (skipOps.length > 0) {
        try {
          const recorded = await persistSkippedDocuments(
            connector.knowledgeBaseId,
            connectorId,
            connector.connectorType,
            skipOps,
            sourceConfig,
            documentAccess,
            input.lease
          )
          result.docsSkipped += recorded.length
        } catch (error) {
          if (error instanceof SyncLockLostException) throw error
          /**
           * The source items were intentionally skipped, but failing to persist their visible
           * failed rows is an actual sync failure.
           */
          result.docsFailed += skipOps.length
          for (const op of skipOps) {
            failedExternalIds.add(op.extDoc.externalId)
          }
          logger.error('Failed to record skipped documents', {
            connectorId,
            count: skipOps.length,
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
              sourceConfig,
              documentAccess,
              input.lease
            )
          }
          return updateDocument(
            op.existingId,
            connector.knowledgeBaseId,
            connectorId,
            connector.connectorType,
            op.extDoc,
            kbOwner,
            sourceConfig,
            documentAccess,
            input.lease
          )
        })
      )

      const leaseLost = settled.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === 'rejected' && outcome.reason instanceof SyncLockLostException
      )
      if (leaseLost) throw leaseLost.reason

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

      for (const doc of batchDocs) {
        pendingDispatch.push(doc)
        if (pendingDispatch.length === PROCESSING_DISPATCH_BATCH_SIZE) await flushDispatch()
      }
      if (!bufferDispatch) await flushDispatch()
      /** Persist completed siblings before yielding; deferred sources remain on this page for retry. */
      const attempted = rawBatch
        .filter((op) => !deferredExternalIds.has(op.extDoc.externalId))
        .map((op) => op.extDoc)
      if (attempted.length > 0) await input.onBatchComplete?.(attempted)
      if (hydrationDeferral !== undefined) throw hydrationDeferral
    }
    return true
  } finally {
    await flushDispatch()
  }
}

/** What the stuck-document sweep needs from the engine that runs it. */
export interface SweepStuckDocumentsInput {
  connectorId: string
  knowledgeBaseId: string
  /** Documents uploaded at or after this instant belong to the current run and are left alone. */
  syncStartedAt: Date
  /** Documents older than this are outside the retry window. */
  retryCutoff: Date
  billingAttribution: BillingAttributionSnapshot
  result: SyncResult
  lease: SyncRunLease
}

/**
 * Reclaims documents this connector left unfinished: a terminated attempt, a
 * dispatch that never produced a run, or a run abandoned mid-processing.
 *
 * The query applies each status's age rule before the candidate limit, so
 * recently requeued old uploads cannot hide genuinely overdue work. The same
 * rules are evaluated again after candidate rows are locked. Skipped
 * documents are content-less `failed` rows with no storage key and therefore
 * remain excluded outright.
 */
export async function sweepStuckDocuments(input: SweepStuckDocumentsInput): Promise<void> {
  const { connectorId, knowledgeBaseId, syncStartedAt, retryCutoff, billingAttribution, result } =
    input

  const sweepEvaluatedAt = new Date()
  const queuedGraceCutoff = new Date(sweepEvaluatedAt.getTime() - QUEUED_DISPATCH_GRACE_MS)
  const processingStaleCutoff = new Date(
    sweepEvaluatedAt.getTime() - STALE_PROCESSING_MINUTES * 60 * 1000
  )
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
      processingDeferredUntil: document.processingDeferredUntil,
      processingCompletedAt: document.processingCompletedAt,
      uploadedAt: document.uploadedAt,
    })
    .from(document)
    .where(
      and(
        eq(document.connectorId, connectorId),
        inArray(document.processingStatus, SWEEPABLE_PROCESSING_STATUSES),
        isNotNull(document.contentHash),
        or(
          and(
            eq(document.processingStatus, 'failed'),
            sql`COALESCE(${document.processingCompletedAt}, ${document.processingQueuedAt}, ${document.uploadedAt}) < ${sql.param(queuedGraceCutoff, document.processingCompletedAt)}`
          ),
          and(
            eq(document.processingStatus, 'pending'),
            or(
              and(
                isNotNull(document.processingDeferredUntil),
                lt(document.processingDeferredUntil, queuedGraceCutoff)
              ),
              and(
                isNull(document.processingDeferredUntil),
                sql`COALESCE(${document.processingQueuedAt}, ${document.uploadedAt}) < ${sql.param(queuedGraceCutoff, document.processingQueuedAt)}`
              )
            )
          ),
          and(
            eq(document.processingStatus, 'processing'),
            or(
              isNull(document.processingStartedAt),
              lt(document.processingStartedAt, processingStaleCutoff)
            )
          )
        ),
        /**
         * Dead letters are left alone: past the budget, re-dispatching only
         * re-bills a document that has failed the same way every time.
         */
        lt(document.processingAttempts, MAX_PROCESSING_ATTEMPTS),
        lt(document.uploadedAt, syncStartedAt),
        gt(document.uploadedAt, retryCutoff),
        eq(document.userExcluded, false),
        isNotNull(document.storageKey),
        isNull(document.archivedAt),
        isNull(document.deletedAt)
      )
    )
    .orderBy(
      asc(sql`CASE
          WHEN ${document.processingStatus} = 'failed'
            THEN COALESCE(${document.processingCompletedAt}, ${document.processingQueuedAt}, ${document.uploadedAt})
          WHEN ${document.processingStatus} = 'pending'
            THEN COALESCE(${document.processingDeferredUntil}, ${document.processingQueuedAt}, ${document.uploadedAt})
          ELSE COALESCE(${document.processingStartedAt}, ${sql.param(new Date(0), document.processingStartedAt)})
        END`),
      asc(document.id)
    )
    .limit(STUCK_RETRY_MAX_CANDIDATES_PER_SYNC)
  const stuckDocs = sweepCandidates.filter(
    (row): row is typeof row & { processingStatus: DocumentProcessingStatus } =>
      isDocumentProcessingStatus(row.processingStatus)
  )

  if (stuckDocs.length === 0) return

  logger.info(`Retrying ${stuckDocs.length} stuck documents`, { connectorId })
  try {
    const stuckDocIds = stuckDocs.map((doc) => doc.id)
    let retryDocs: typeof stuckDocs = []

    /**
     * Locks the parent first to match lifecycle mutations, then proves this
     * run still owns the live connector row. A bare connector lock can match
     * a replacement run after this lease was reclaimed, allowing the stale
     * run to reset documents and dispatch duplicate processing.
     */
    await db.transaction(async (tx) => {
      const [activeKnowledgeBase] = await tx
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
        .for('update')
      if (!activeKnowledgeBase) throw new SyncLockLostException(connectorId)

      const [heldSyncLock] = await tx
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(input.lease.stillHeld())
        .for('update')
      if (!heldSyncLock) throw new SyncLockLostException(connectorId)

      const lockedCandidates = await tx
        .select({
          id: document.id,
          fileUrl: document.fileUrl,
          filename: document.filename,
          fileSize: document.fileSize,
          mimeType: document.mimeType,
          processingStatus: document.processingStatus,
          processingQueuedAt: document.processingQueuedAt,
          processingStartedAt: document.processingStartedAt,
          processingDeferredUntil: document.processingDeferredUntil,
          processingCompletedAt: document.processingCompletedAt,
          uploadedAt: document.uploadedAt,
        })
        .from(document)
        .where(
          and(
            inArray(document.id, stuckDocIds),
            eq(document.connectorId, connectorId),
            inArray(document.processingStatus, SWEEPABLE_PROCESSING_STATUSES),
            isNotNull(document.contentHash),
            lt(document.processingAttempts, MAX_PROCESSING_ATTEMPTS),
            eq(document.userExcluded, false),
            isNotNull(document.storageKey),
            isNull(document.archivedAt),
            isNull(document.deletedAt)
          )
        )
        .orderBy(asc(document.id))
        .for('update')

      retryDocs = selectStuckDocumentSweepCandidates(
        lockedCandidates.filter(
          (row): row is typeof row & { processingStatus: DocumentProcessingStatus } =>
            isDocumentProcessingStatus(row.processingStatus)
        ),
        sweepEvaluatedAt
      )

      if (retryDocs.length > 0) {
        const retryDocIds = retryDocs.map((doc) => doc.id)

        const reset = await tx
          .update(document)
          .set({
            processingStatus: 'pending',
            /**
             * Invalidates the prior dispatch generation in the same write
             * that reopens the row. The dispatch below installs its fresh
             * generation through `markDocumentsQueued`.
             */
            processingQueuedAt: null,
            processingQueueToken: null,
            processingStartedAt: null,
            processingDeferredUntil: null,
            processingCompletedAt: null,
            processingError: null,
            chunkCount: 0,
            tokenCount: 0,
            characterCount: 0,
          })
          /**
           * These rows were freshly revalidated and locked above. The
           * lifecycle predicates remain as defence in depth; the row locks
           * ensure no retry can install a newer queue generation between
           * that eligibility decision and this reset.
           */
          .where(
            and(
              inArray(document.id, retryDocIds),
              eq(document.connectorId, connectorId),
              inArray(document.processingStatus, SWEEPABLE_PROCESSING_STATUSES),
              isNotNull(document.contentHash),
              lt(document.processingAttempts, MAX_PROCESSING_ATTEMPTS),
              eq(document.userExcluded, false),
              isNotNull(document.storageKey),
              isNull(document.archivedAt),
              isNull(document.deletedAt)
            )
          )
          .returning({ id: document.id })

        /**
         * Embeddings are dropped only for documents this sweep actually
         * reset. Deleting first would strip a pass that completed between
         * the candidate SELECT and this write.
         */
        const resetIds = reset.map((row) => row.id)
        if (resetIds.length > 0) {
          await tx.delete(embedding).where(inArray(embedding.documentId, resetIds))
        }
        const resetIdSet = new Set(resetIds)
        retryDocs = retryDocs.filter((doc) => resetIdSet.has(doc.id))
      }
    })

    for (let i = 0; i < retryDocs.length; i += PROCESSING_DISPATCH_BATCH_SIZE) {
      await input.lease.beatLive()

      const retryChunk = retryDocs.slice(i, i + PROCESSING_DISPATCH_BATCH_SIZE)
      result.processingDispatch.requested += retryChunk.length
      const dispatch = await processDocumentsWithQueue(
        retryChunk.map((doc) => ({
          documentId: doc.id,
          filename: doc.filename ?? 'document.txt',
          fileUrl: doc.fileUrl ?? '',
          fileSize: doc.fileSize ?? 0,
          mimeType: doc.mimeType ?? 'text/plain',
        })),
        knowledgeBaseId,
        {},
        generateId(),
        billingAttribution,
        { connectorId, stillHeld: input.lease.stillHeld }
      )
      result.processingDispatch.accepted += dispatch.accepted
      result.processingDispatch.failed += dispatch.failed
    }
  } catch (error) {
    /**
     * Kept out of the best-effort swallow below. A run that has provably
     * lost its lock would otherwise be mislabelled an enqueue failure, fall
     * through and publish an atomic completed outcome, which a replacement
     * run could then read as corroboration of its own listing.
     */
    if (error instanceof SyncLockLostException) throw error

    logger.warn('Failed to enqueue stuck documents for reprocessing', {
      connectorId,
      count: stuckDocs.length,
      error: toError(error).message,
    })
    result.processingDispatch.failed +=
      result.processingDispatch.requested -
      result.processingDispatch.accepted -
      result.processingDispatch.failed
  }
}
