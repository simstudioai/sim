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
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import { decryptApiKey } from '@/lib/api-key/crypto'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { env, envNumber } from '@/lib/core/config/env'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { resolveCredentialTokenIdentity } from '@/lib/credentials/access'
import {
  CONNECTOR_AUTO_DISABLED_ERROR,
  connectorFailureBackoffMinutes,
  MAX_CONSECUTIVE_FAILURES,
  SYNC_LOCK_HEARTBEAT_INTERVAL_MS,
} from '@/lib/knowledge/connectors/sync-limits'
import { DOCUMENT_PROCESSING_STALE_THRESHOLD_MS } from '@/lib/knowledge/documents/processing-timeouts.server'
import type { DocumentData } from '@/lib/knowledge/documents/service'
import {
  ConnectorSyncDeletionGuardError,
  hardDeleteDocuments,
  processDocumentsWithQueue,
} from '@/lib/knowledge/documents/service'
import {
  type DocumentProcessingStatus,
  isDocumentProcessingStatus,
  MAX_PROCESSING_ATTEMPTS,
  QUEUED_DISPATCH_GRACE_MS,
} from '@/lib/knowledge/documents/types'
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

/**
 * Raised when a run discovers mid-flight that it no longer holds its sync lock.
 *
 * Stops it doing hours of further work whose terminal write would be rejected,
 * and — more importantly — stops it writing documents concurrently with the
 * replacement run that took the lock.
 */
class SyncLockLostException extends Error {
  constructor(connectorId: string) {
    super(`Sync lock for connector ${connectorId} was reclaimed during sync`)
    this.name = 'SyncLockLostException'
  }
}

class ConnectorDeletedException extends Error {
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
/**
 * Maximum documents retained in either the source corpus or owned corpus.
 *
 * The engine needs the complete source identity set and the connector's complete
 * owned-document set at the same time to distinguish adds from updates and to
 * reconcile deletions safely. Page-count limits alone do not bound that working
 * set: a connector page can contain many documents, and an incremental connector
 * can accumulate a corpus much larger than its current page. The two corpora
 * coexist, so the row-count peak is twice this value plus bounded
 * maps and operation references. Crossing either per-corpus ceiling fails before
 * document writes.
 */
export const CONNECTOR_SYNC_MAX_CORPUS_DOCUMENTS = 50_000

export const CONNECTOR_SYNC_MAX_SOURCE_PAYLOAD_BYTES = 256 * 1024 * 1024
const MAX_SAFE_TITLE_LENGTH = 200
/**
 * How many stuck documents are re-dispatched per call.
 *
 * The retry backlog is unbounded, and on the in-process fallback path
 * `processDocumentsWithQueue` parses, embeds, and indexes every document it is
 * given before returning. Handing it the whole backlog made the retry a single
 * await no heartbeat could interrupt; chunking gives the beat somewhere to run.
 */
const STUCK_RETRY_DISPATCH_CHUNK_SIZE = 25

/**
 * How many stuck-document candidates one sync will consider.
 *
 * {@link STUCK_RETRY_DISPATCH_CHUNK_SIZE} paces the dispatch loop but does not
 * bound it — the candidate query had no limit, so a connector carrying a large
 * backlog dispatched the whole thing at once. One did: 2,959 documents enqueued
 * in fifteen seconds onto a queue every workspace shares, at
 * {@link PROCESSING_QUEUE_CONCURRENCY} concurrent runs. Nothing was
 * double-billed — those documents were genuinely unindexed — but one connector
 * monopolized the queue, and each dispatch mints a fresh `requestId`, so the
 * Trigger.dev idempotency key differs every pass and none of it deduplicates.
 *
 * 200 keeps a single sync's contribution to roughly ten minutes of queue
 * occupancy at the default concurrency. A backlog larger than this is not
 * dropped: candidates are taken oldest-first and whatever is left stays
 * eligible, so consecutive syncs drain it steadily instead of in one burst.
 */
export const STUCK_RETRY_MAX_CANDIDATES_PER_SYNC = 200

/**
 * How many documents reconciliation hard-deletes per call.
 *
 * `hardDeleteDocuments` deletes storage objects, embeddings, and rows for its
 * whole argument in serialized transactions, and a forced `fullSync` overriding
 * a connector's listing cap can hand it tens of thousands of ids — one await
 * spanning the widest gap between heartbeats in the sync, with the deletes
 * themselves the slowest work in it. Chunking gives the beat somewhere to run,
 * so a long purge stops looking dead to the reaper. Sized like the dispatch
 * chunk above: small enough that a chunk cannot outlast the heartbeat interval,
 * large enough that the per-call overhead stays negligible.
 */
const HARD_DELETE_CHUNK_SIZE = 25
const CONNECTOR_DELETION_CLEANUP_BATCH_SIZE = 250
/**
 * Concurrent `knowledge-process-document` runs, shared by every workspace.
 *
 * Read from the same env var the task itself is configured with rather than
 * restated, so the drain estimate below cannot describe a queue depth the
 * deployment does not actually run.
 */
const PROCESSING_QUEUE_CONCURRENCY = envNumber(env.KB_CONFIG_CONCURRENCY_LIMIT, 20)

class ConnectorSyncCapacityError extends Error {}

class ConnectorSyncWorkingSetLimitError extends ConnectorSyncCapacityError {
  constructor(connectorId: string, scope: 'source listing' | 'owned corpus') {
    super(
      `Connector ${connectorId} ${scope} exceeds the safe per-corpus limit of ${CONNECTOR_SYNC_MAX_CORPUS_DOCUMENTS.toLocaleString()} documents. Narrow the configured source scope or set a connector document limit before syncing again.`
    )
    this.name = 'ConnectorSyncWorkingSetLimitError'
  }
}

/**
 * Returns a query's sentinel-inclusive limit for the remaining working-set
 * budget. The extra row proves the corpus exceeded the cap without loading the
 * rest of it.
 */
export function syncWorkingSetQueryLimit(rowsAlreadyLoaded: number): number {
  return Math.max(CONNECTOR_SYNC_MAX_CORPUS_DOCUMENTS - rowsAlreadyLoaded, 0) + 1
}

export function sourcePageFitsSyncWorkingSet(rowsAlreadyLoaded: number, pageRows: number): boolean {
  return rowsAlreadyLoaded + pageRows <= CONNECTOR_SYNC_MAX_CORPUS_DOCUMENTS
}

function assertSyncWorkingSetWithinLimit(
  connectorId: string,
  rowsAlreadyLoaded: number,
  rowsJustLoaded: number
): void {
  if (rowsAlreadyLoaded + rowsJustLoaded > CONNECTOR_SYNC_MAX_CORPUS_DOCUMENTS) {
    throw new ConnectorSyncWorkingSetLimitError(connectorId, 'owned corpus')
  }
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

export {
  resolveStaleProcessingMinutes,
  worstCaseProcessingMinutes,
} from '@/lib/knowledge/documents/types'

/**
 * How long a document may sit in `processing` before the sweep treats its run as
 * abandoned — and deletes its embeddings and re-dispatches it.
 *
 * DERIVED, not fixed at 45. The sweep reclaims by deleting live work, so this
 * must exceed the longest a legitimate run can take. That bound is
 * `KB_CONFIG_MAX_DURATION` x `KB_CONFIG_MAX_ATTEMPTS`, which an operator can
 * raise: at the previous hard-coded 45, setting `KB_CONFIG_MAX_DURATION` above
 * 900s silently made every long run look abandoned, so the sweep would delete
 * the embeddings of documents that were still being indexed and bill a second
 * pass. Deriving it keeps the invariant true at any configuration; the floor
 * preserves today's value at the defaults.
 */
const STALE_PROCESSING_MINUTES = DOCUMENT_PROCESSING_STALE_THRESHOLD_MS / (60 * 1000)
const RETRY_WINDOW_DAYS = 7
const RUNNABLE_CONNECTOR_STATUSES = ['active', 'error'] as const

/** Whether an automatic connector sync may begin from this persisted state. */
export function isConnectorRunnableStatus(status: string): boolean {
  return RUNNABLE_CONNECTOR_STATUSES.some((runnableStatus) => runnableStatus === status)
}

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
 * Decides whether the sweep may reclaim one document — delete its embeddings,
 * reset it, and dispatch it again.
 *
 * Since document processing is dispatched to `knowledge-process-document`
 * rather than awaited inline, a document sits at `pending` from dispatch until
 * a worker claims it; `processing` is only written once a worker has actually
 * started. Reclaiming a `pending` document therefore risks racing a run that is
 * still queued, which both duplicates its work and bills a second indexing
 * pass, so queued documents get {@link QUEUED_DISPATCH_GRACE_MS} before they
 * are considered lost — the same grace the user-facing retry waits out before
 * it will admit a `pending` document.
 *
 * Queue wait is measured from `processingQueuedAt`, stamped in one place —
 * `markDocumentsQueued`, which every dispatch funnels through, so the column
 * always describes the attempt that is live right now.
 * It falls back to `uploadedAt` when NULL, which covers a document dispatched
 * by the sync that created it (`uploadedAt` then sits within that sync's own
 * runtime, an over-estimate bounded by the one-hour sync ceiling) and rows
 * written before the column existed.
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
 * The grace decides when a queued run may be superseded, but correctness does
 * not depend on that timing judgment. Every task carries the queue stamp its
 * dispatch installed and must match it before claiming or billing the row. A
 * sweep clears the abandoned stamp before installing a new one, so a late old
 * task declines while the replacement proceeds. Queue admission also claims
 * only an empty stamp, preventing concurrent callers from charging or enqueuing
 * two live generations for the same pending document.
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
    // No `default`: a status added to DocumentProcessingStatus must fail
    // type-check here rather than silently reading as "not eligible".
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
  | { type: 'skip'; existingId?: string; extDoc: ExternalDocument }

type DocClassification =
  | { type: 'add' }
  | { type: 'update'; existingId: string }
  | { type: 'skip'; existingId?: string }
  | { type: 'unchanged' }
  | { type: 'drop' }

/**
 * Decides what a listed external document becomes during reconciliation.
 *
 * - `skip`: connector flagged it (e.g. too large) and it is not already indexed —
 *   record a visible `failed` document instead of dropping it silently. Existing
 *   content stays last-known-good unless the connector marks the skip authoritative.
 * - `drop`: empty, non-deferred content that cannot be indexed.
 * - `add` / `update` / `unchanged`: normal content reconciliation by content hash.
 * - A deferred listing always rehydrates an existing content-less placeholder,
 *   even when its listing hash is unchanged, so a prior hydration-time skip can
 *   recover when the source becomes indexable.
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
  >,
  existing: { id: string; contentHash: string | null; storageKey?: string | null } | undefined,
  forceRehydrate = false
): DocClassification {
  if (extDoc.skippedReason) {
    if (!existing) return { type: 'skip' }
    return existing.storageKey === null || extDoc.skippedExistingDisposition === 'replace'
      ? { type: 'skip', existingId: existing.id }
      : { type: 'unchanged' }
  }
  if (!hasIndexablePayload(extDoc) && !extDoc.contentDeferred) {
    return { type: 'drop' }
  }
  if (!existing) {
    return { type: 'add' }
  }
  if (existing.storageKey === null && extDoc.contentDeferred) {
    return { type: 'update', existingId: existing.id }
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

/**
 * Merges a hydration-time skip marker onto its listing stub.
 *
 * A skipped hydration did not verify indexable content, so its provider-specific
 * fallback hash cannot supersede the listing hash used by the next sync's change
 * classification. Keeping the listing hash makes a newly persisted skip stable
 * until the source metadata changes. A connector can explicitly provide
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
    contentHash: hydrated.skippedRetryContentHash ?? stub.contentHash,
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
  // Skip ops load no content (just a row insert), so they do not count against the
  // in-flight content budget.
  if (op.type === 'skip') return 0
  if (op.extDoc.sourceFile?.bytes) return op.extDoc.sourceFile.bytes.byteLength
  if (op.extDoc.content) return Buffer.byteLength(op.extDoc.content)
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

/**
 * Single-roundtrip check that this sync's targets still exist.
 *
 * Named for presence rather than liveness deliberately: this file uses
 * "liveness" in its distributed-systems sense — a run proving it is still
 * working, via {@link heartbeatSyncLock} — and reusing the word for a row
 * existence check conflated two unrelated questions three lines apart.
 */
async function checkSyncTargetPresence(
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

/** Options for a sync-log close. */
interface CompleteSyncLogOptions {
  /** Recorded on the row when the run is being closed as `failed`. */
  errorMessage?: string
  /**
   * Connector whose sync lock this run must still hold for the close to land.
   *
   * Only the success path passes it. A `completed` row is the one sync-log
   * state that is read back as evidence — {@link loadPreviousListingObservation}
   * selects `status = 'completed'` — so it must not outlive the connector
   * bookkeeping it corroborates. `failed` rows are never read that way, and both
   * failure paths legitimately close a run whose lock is already gone.
   */
  requireSyncLockOn?: string
}

/**
 * Matches the log row only while its run still holds the connector's sync lock.
 *
 * The row's own `status = 'started'` guard defers to the scheduler's sweep, but
 * the sweep is not the only writer that can strand a live run. The
 * knowledge-base-deleted writers clear the token unconditionally, a user pausing
 * a connector flips it out of `syncing`, and the reaper's reclaim and its
 * log-close are two statements that can commit apart. In each case the run's
 * terminal connector write is refused while its log row is still `started`, so an
 * unguarded close publishes a `completed` row for bookkeeping that was discarded.
 *
 * Reuses {@link stillHoldsSyncLock} rather than restating the predicate, so the
 * log row and the connector row are written under exactly the same condition and
 * cannot disagree. A refused close leaves the row `started`; the scheduler's
 * sync-log sweep drains it, and that sweep is deliberately not connector-scoped,
 * so it still closes the row on an archived connector the reclaim skips.
 */
function syncLogRunStillHoldsLock(connectorId: string, syncLogId: string) {
  return exists(
    db
      .select({ held: sql`1` })
      .from(knowledgeConnector)
      .where(stillHoldsSyncLock(connectorId, syncLogId))
  )
}

/**
 * Records a sync run's outcome on its log row.
 *
 * Guarded on `status = 'started'` so a run that outlives
 * {@link CONNECTOR_SYNC_STALE_LOCK_TTL_MS} cannot overwrite a row the
 * scheduler's stale sweep already closed. Without the guard the two writers
 * race and produce contradictory history: the sweep marks the row `failed`,
 * then the still-running sync reports `completed` on the same row.
 *
 * That guard alone is a no-op on the normal path — nothing else touches the row
 * between its `started` insert and this call — so it only bites once the sweep
 * has declared the run dead, and the sweep's verdict is the one that stands.
 * {@link CompleteSyncLogOptions.requireSyncLockOn} covers the writers that strand
 * a run without going through the sweep.
 *
 * Returns whether the close landed. False means this run no longer owns the
 * outcome it was about to publish.
 */
export async function completeSyncLog(
  syncLogId: string,
  status: 'completed' | 'failed',
  result: SyncResult,
  options: CompleteSyncLogOptions = {}
): Promise<boolean> {
  const { errorMessage, requireSyncLockOn } = options

  const closed = await db
    .update(knowledgeConnectorSyncLog)
    .set({
      status,
      completedAt: new Date(),
      ...(errorMessage != null && { errorMessage }),
      docsAdded: result.docsAdded,
      docsUpdated: result.docsUpdated,
      docsDeleted: result.docsDeleted,
      docsUnchanged: result.docsUnchanged,
      docsSkipped: result.docsSkipped,
      docsFailed: result.docsFailed,
    })
    .where(
      and(
        eq(knowledgeConnectorSyncLog.id, syncLogId),
        eq(knowledgeConnectorSyncLog.status, 'started'),
        ...(requireSyncLockOn != null
          ? [syncLogRunStillHoldsLock(requireSyncLockOn, syncLogId)]
          : [])
      )
    )
    .returning({ id: knowledgeConnectorSyncLog.id })

  return closed.length > 0
}

class SyncCompletionOwnershipLost extends Error {
  constructor() {
    super('Connector sync no longer owns its terminal state')
    this.name = 'SyncCompletionOwnershipLost'
  }
}

/**
 * Atomically publishes the completed log and connector terminal state.
 *
 * The knowledge base is locked first to match lifecycle mutations, then the
 * connector lock is verified under `FOR UPDATE`. A completed log can therefore
 * never become visible unless the matching connector state commits with it.
 */
export async function completeSuccessfulSync(
  connectorId: string,
  knowledgeBaseId: string,
  syncLogId: string,
  syncIntervalMinutes: number,
  result: SyncResult,
  reconciliationHoldNotice: string | null
): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      const [lockedKnowledgeBase] = await tx
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(and(eq(knowledgeBase.id, knowledgeBaseId), isNull(knowledgeBase.deletedAt)))
        .for('update')
      if (!lockedKnowledgeBase) throw new SyncCompletionOwnershipLost()

      const [lockedConnector] = await tx
        .select({ id: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(stillHoldsSyncLock(connectorId, syncLogId))
        .for('update')
      if (!lockedConnector) throw new SyncCompletionOwnershipLost()

      const [{ count: actualDocCount }] = await tx
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
      const [closedLog] = await tx
        .update(knowledgeConnectorSyncLog)
        .set({
          status: 'completed',
          completedAt: now,
          docsAdded: result.docsAdded,
          docsUpdated: result.docsUpdated,
          docsDeleted: result.docsDeleted,
          docsUnchanged: result.docsUnchanged,
          docsSkipped: result.docsSkipped,
          docsFailed: result.docsFailed,
        })
        .where(
          and(
            eq(knowledgeConnectorSyncLog.id, syncLogId),
            eq(knowledgeConnectorSyncLog.status, 'started')
          )
        )
        .returning({ id: knowledgeConnectorSyncLog.id })
      if (!closedLog) throw new SyncCompletionOwnershipLost()

      const [writtenConnector] = await tx
        .update(knowledgeConnector)
        .set(
          buildSyncSuccessUpdate(
            now,
            actualDocCount,
            calculateNextSyncTime(syncIntervalMinutes),
            reconciliationHoldNotice,
            result.docsFailed === 0
          )
        )
        .where(stillHoldsSyncLock(connectorId, syncLogId))
        .returning({ id: knowledgeConnector.id })
      if (!writtenConnector) throw new SyncCompletionOwnershipLost()

      return true
    })
  } catch (error) {
    if (error instanceof SyncCompletionOwnershipLost) return false
    throw error
  }
}

/**
 * Matches the connector row only while this run still holds its sync lock.
 *
 * `status = 'syncing'` alone is not enough: it asserts that *a* run holds the
 * lock, not that *this* run does. Once the scheduler reclaims a stale lock and
 * dispatches a replacement, the replacement sets `syncing` again — so the
 * original run would match, overwrite the replacement's in-flight state and the
 * reclaim's bookkeeping, and then reject the replacement's own write as
 * superseded. The dead run wins and the live one loses, which is worse than the
 * unguarded last-write-wins it replaced.
 *
 * `syncLockToken` is written in the same CAS that takes the lock, so matching it
 * proves the lock is still this run's. `status` is kept alongside as defence in
 * depth and to cover a user pausing the connector mid-run.
 *
 * Guards every write a run makes to its own connector row: both terminal paths
 * and the mid-run heartbeat. The failure path needs it as much as the success
 * path — a reclaimed run's failure would double-increment a counter the sweep
 * already advanced and overwrite its backoff with a shorter one — and reusing it
 * for the heartbeat is what turns a beat into an ownership probe.
 */
export function stillHoldsSyncLock(connectorId: string, syncLockToken: string) {
  return and(holdsSyncLockToken(connectorId, syncLockToken), connectorIsLive())
}

/** The archived/deleted half of {@link stillHoldsSyncLock}. */
export function connectorIsLive() {
  return and(isNull(knowledgeConnector.archivedAt), isNull(knowledgeConnector.deletedAt))
}

/**
 * Ownership only: this run still holds the lock, regardless of whether the
 * connector has since been archived or deleted.
 *
 * The heartbeat guards on this rather than on {@link stillHoldsSyncLock} so a
 * connector deleted mid-sync does not read as lock loss. It would otherwise
 * raise `SyncLockLostException` before `checkSyncTargetPresence` ever ran, skipping
 * the leftover-document cleanup that `ConnectorDeletedException` performs and
 * leaving the sync-log row `started` until the sweep mislabelled it. Deletion is
 * the liveness check's verdict to reach, not the heartbeat's.
 */
export function holdsSyncLockToken(connectorId: string, syncLockToken: string) {
  return and(
    eq(knowledgeConnector.id, connectorId),
    eq(knowledgeConnector.status, 'syncing'),
    eq(knowledgeConnector.syncLockToken, syncLockToken)
  )
}

/**
 * The connector row a run writes when it takes the sync lock.
 *
 * `syncLockToken` is set here, in the same statement as `status`, so ownership
 * and the lock are established atomically — a token written afterwards would
 * leave a window where a terminal write could not identify its own run.
 *
 * `syncLockLeaseAt` opens the lease at the same instant. It is deliberately not
 * `updatedAt`: the reaper reads the lease, and `updatedAt` moves on every
 * unrelated write to the row, so a config edit on a wedged connector used to
 * renew the lock it was meant to recover.
 */
/**
 * The statuses a run may take the lock from.
 *
 * An allowlist rather than `ne(status, 'syncing')`, because the queue outlives
 * the decision to sync: a connector paused or disabled *after* its run was
 * queued still had a task in flight, and a bare not-syncing test let that task
 * lock the row and then write its own terminal status over the pause. This CAS
 * is the single point where a run decides to start, so it is where the refusal
 * belongs — the dispatch-side guards cannot see a status change that happens
 * after they ran.
 */
export const LOCKABLE_CONNECTOR_STATUSES = ['active', 'error', 'pending'] as const

export function buildSyncLockAcquisition(syncLogId: string, now: Date) {
  return {
    status: 'syncing' as const,
    syncLockToken: syncLogId,
    syncLockLeaseAt: now,
    updatedAt: now,
  }
}

/**
 * Whether a running sync is due to refresh its lock.
 *
 * Time-based rather than batch-count-based: batches vary hugely in cost, so an
 * every-N-batches beat would fire constantly on small documents and barely at
 * all on large ones — exactly the runs that need it.
 */
export function shouldHeartbeatSyncLock(
  nowMs: number,
  lastBeatMs: number,
  intervalMs: number = SYNC_LOCK_HEARTBEAT_INTERVAL_MS
): boolean {
  return nowMs - lastBeatMs >= intervalMs
}

/**
 * Extends the connector's lock lease to prove this run is still working, so the
 * scheduler's stale-lock reclaim does not treat a slow-but-live sync as dead.
 *
 * Writes `syncLockLeaseAt` alone and deliberately leaves `updatedAt` untouched:
 * a beat says nothing about the row's contents, and the two columns had to be
 * separated so an unrelated write could stop passing for a heartbeat.
 *
 * Guarded on the run's own lock, so it doubles as an ownership probe: a false
 * return means the lock was reclaimed and this run must stop rather than keep
 * writing alongside its replacement.
 */
async function writeSyncHeartbeat(
  condition: ReturnType<typeof holdsSyncLockToken>
): Promise<boolean> {
  const beat = await db
    .update(knowledgeConnector)
    .set({ syncLockLeaseAt: new Date() })
    .where(condition)
    .returning({ id: knowledgeConnector.id })

  return beat.length > 0
}

export async function heartbeatSyncLock(
  connectorId: string,
  syncLockToken: string
): Promise<boolean> {
  return writeSyncHeartbeat(holdsSyncLockToken(connectorId, syncLockToken))
}

/**
 * Extends the lease only while this run owns a live connector. Destructive
 * follow-up work uses this stricter probe immediately before dispatch so a run
 * reclaimed after its transaction cannot enqueue alongside its replacement.
 */
export async function heartbeatLiveSyncLock(
  connectorId: string,
  syncLockToken: string
): Promise<boolean> {
  return writeSyncHeartbeat(stillHoldsSyncLock(connectorId, syncLockToken))
}

/** Columns a terminal write may set. Both paths write a subset of the same set. */
type ConnectorTerminalUpdate = Partial<typeof knowledgeConnector.$inferInsert>

/**
 * The only way a sync run writes its terminal state onto the connector row.
 *
 * Callers pass their own values and never build a WHERE clause: the
 * {@link stillHoldsSyncLock} guard is applied here, so there is exactly one
 * place it can be removed from and a terminal path added later cannot forget
 * it. Returns whether the write landed — false means the run was reclaimed
 * mid-flight and its bookkeeping was discarded in favour of whoever took the
 * row.
 */
export async function writeTerminalConnectorState(
  connectorId: string,
  syncLockToken: string,
  values: ConnectorTerminalUpdate
): Promise<boolean> {
  const written = await db
    .update(knowledgeConnector)
    .set(values)
    .where(stillHoldsSyncLock(connectorId, syncLockToken))
    .returning({ id: knowledgeConnector.id })

  return written.length > 0
}

/**
 * Releases the sync lock on a connector that was archived out from under a
 * running sync.
 *
 * `ConnectorDeletedException`'s handler is a terminal exit that wrote nothing to
 * the connector row, leaving it `status = 'syncing'` with this run's token still
 * on it. Nothing else can clear that: the scheduler's reclaim requires
 * `isNull(archivedAt)` and `isNull(deletedAt)`, so the one writer able to correct
 * a stranded lock skips exactly the rows this path creates. Both other "the
 * target is gone" exits — the knowledge-base-deleted writers here and in the
 * dispatch queue — already release token and lease and make the transition
 * terminal; this makes the third behave the same way.
 *
 * Guarded on {@link holdsSyncLockToken} rather than {@link stillHoldsSyncLock}
 * for the same reason the heartbeat is: the connector being archived is the
 * precondition of this path, so requiring it to still be live would reject every
 * write this function exists to make. Ownership alone is enough — the token
 * proves the lock is this run's, so a replacement's lock can never be released.
 *
 * A no-op when the connector row was hard-deleted rather than archived, which is
 * what a user-initiated connector delete does: there is no row left to unwedge.
 */
async function releaseSyncLockOnDeletedConnector(
  connectorId: string,
  syncLogId: string
): Promise<void> {
  await db
    .update(knowledgeConnector)
    .set({
      status: 'error',
      nextSyncAt: null,
      lastSyncError: 'Connector deleted during sync',
      syncLockToken: null,
      syncLockLeaseAt: null,
      updatedAt: new Date(),
    })
    .where(holdsSyncLockToken(connectorId, syncLogId))
}

/**
 * Reported when a run loses its connector's lock mid-flight — either because a
 * heartbeat found the lock reclaimed, or because its terminal write matched no
 * rows. Its document writes still landed; only its connector-level bookkeeping
 * was discarded, in favour of whoever reclaimed the row.
 */
export const SUPERSEDED_SYNC_ERROR = 'sync_superseded'

/**
 * Marks a superseded run with typed control flow so provider diagnostics can
 * never collide with a lifecycle reason.
 */
export function markSyncSuperseded(result: SyncResult): SyncResult {
  return { ...result, skipReason: SUPERSEDED_SYNC_ERROR }
}

/**
 * Decides whether deletion reconciliation may run for a sync.
 *
 * Reconciliation hard-deletes every stored document absent from the listing,
 * so it must only run against a complete source set:
 * - never on incremental syncs (they list only changed documents)
 * - never when the engine truncated pagination (`listingTruncated`) — a forced
 *   fullSync cannot fix truncation, so it cannot override it
 * - never when a provider declares its pagination non-authoritative
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
  if (syncContext?.reconciliationUnsafe) return false
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

/**
 * How many listed documents count toward the suspect-listing ratio.
 *
 * `seenExternalIds` is populated before the classification loop short-circuits
 * user-excluded documents, so it counts them; the owned-document denominator
 * does not, because excluded rows are filtered out of the live read. Comparing
 * the two directly inflates the ratio and silently weakens the collapse guard —
 * with 1,000 owned / 200 excluded, a source returning 90 documents stopped
 * tripping `collapsed` entirely. Subtracting the excluded documents that were
 * listed puts both sides back on the same population.
 */
export function countNonExcludedListed(
  seenExternalIds: ReadonlySet<string>,
  excludedExternalIds: ReadonlySet<unknown>
): number {
  let excludedAndListed = 0
  for (const externalId of seenExternalIds) {
    if (excludedExternalIds.has(externalId)) excludedAndListed++
  }
  return seenExternalIds.size - excludedAndListed
}

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
 * A suspect listing is only acted on after a consecutive suspect observation, so a
 * consecutive sync, so a single transient upstream fault can never remove
 * documents — not even reversibly, since a soft delete hides them from search
 * immediately. A genuinely emptied source keeps reconciling: its second sync
 * corroborates the first and tombstones everything, and a later sync — once the
 * tombstoned set is again absent — completes the two-strike purge, subject to
 * {@link capReconciliationDeletions}, which withholds any generation whose
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
 * Documents a reconciliation pass could actually remove.
 *
 * Both reads are filtered, not just the tombstoned one: the live read already
 * excludes `userExcluded` rows in SQL, so filtering it again is a no-op today,
 * but it keeps this count self-consistent with
 * {@link partitionSyncReconciliation}, which gates deletion on the same flag for
 * both lists. The result is the denominator for the deletion cap and for
 * {@link classifySuspectListing}, whose numerator
 * ({@link countNonExcludedListed}) ranges over the same population.
 */
export function countDeletionEligibleOwned(
  existingDocs: ReconciliationDoc[],
  tombstonedDocs: ReconciliationDoc[]
): number {
  return (
    existingDocs.filter((d) => !d.userExcluded).length +
    tombstonedDocs.filter((d) => !d.userExcluded).length
  )
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
 * The connector row a failed sync writes.
 *
 * Extracted for the same reason as {@link buildSyncSuccessUpdate}: this is the
 * path the auto-disable breaker runs through, so the threshold and the backoff
 * it applies need to be assertable without standing up the whole sync. The
 * in-process ladder here and the reaper's SQL ladder must agree — they are two
 * writers of one policy, both sourced from
 * {@link connectorFailureBackoffMinutes}.
 */
export function buildSyncFailureUpdate(
  now: Date,
  previousFailures: number | null | undefined,
  errorMessage: string
) {
  const failures = (previousFailures ?? 0) + 1
  const disabled = failures >= MAX_CONSECUTIVE_FAILURES

  return {
    status: (disabled ? 'disabled' : 'error') as 'disabled' | 'error',
    lastSyncError: disabled ? CONNECTOR_AUTO_DISABLED_ERROR : errorMessage,
    nextSyncAt: disabled
      ? null
      : new Date(now.getTime() + connectorFailureBackoffMinutes(failures) * 60 * 1000),
    consecutiveFailures: failures,
    // Releases the lock so a stale token can never match a later run, and closes
    // its lease so the reaper is not left waiting out a TTL on a finished run.
    syncLockToken: null,
    syncLockLeaseAt: null,
    updatedAt: now,
  }
}

/**
 * A deterministic capacity rejection needs operator action, not an automatic
 * retry or the transient-failure circuit breaker. Keep its precise diagnostic,
 * release the lock, and leave the connector manually runnable.
 */
export function buildSyncCapacityUpdate(
  now: Date,
  previousFailures: number | null | undefined,
  errorMessage: string
) {
  return {
    status: 'error' as const,
    lastSyncError: errorMessage,
    nextSyncAt: null,
    consecutiveFailures: previousFailures ?? 0,
    syncLockToken: null,
    syncLockLeaseAt: null,
    updatedAt: now,
  }
}

/**
 * The connector row a successful sync writes.
 *
 * `holdNotice` is threaded through rather than written when the hold is detected
 * because this update runs at the very end of the sync and would otherwise clear
 * `lastSyncError` in the same run. `status` stays `active` and
 * `consecutiveFailures` still resets: a held pass is a healthy sync that declined
 * to delete, not a failure, and marking it broken would stop it syncing at all.
 */
export function buildSyncSuccessUpdate(
  now: Date,
  actualDocCount: number,
  nextSyncAt: Date | null,
  holdNotice: string | null,
  advanceLastSyncAt = true
) {
  return {
    status: 'active' as const,
    ...(advanceLastSyncAt ? { lastSyncAt: now } : {}),
    lastSyncError: holdNotice,
    lastSyncDocCount: actualDocCount,
    nextSyncAt,
    consecutiveFailures: 0,
    // Releases the lock so a stale token can never match a later run, and closes
    // its lease so the reaper is not left waiting out a TTL on a finished run.
    syncLockToken: null,
    syncLockLeaseAt: null,
    updatedAt: now,
  }
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

/** Per-connector tuning for the reconciliation blast-radius cap. */
export interface ReconciliationDeleteCapOverride {
  maxRatio?: number
  minAbsolute?: number
}

/**
 * Maximum number of documents one reconciliation pass may remove.
 */
export function resolveReconciliationDeleteCap(
  ownedDocCount: number,
  override?: ReconciliationDeleteCapOverride
): number {
  const maxRatio = override?.maxRatio ?? RECONCILIATION_DELETE_MAX_RATIO
  const minAbsolute = override?.minAbsolute ?? RECONCILIATION_DELETE_MIN_ABSOLUTE
  return Math.max(minAbsolute, Math.floor(Math.max(ownedDocCount, 0) * maxRatio))
}

/**
 * Caps the blast radius of one reconciliation pass.
 *
 * The shape guards above all reason about listings that look *broken*. Two
 * confirmed data-loss paths produce listings that look perfectly healthy and so
 * pass every one of them: a partial outage returning half a corpus (above the
 * 10% collapse threshold), and a change to a connector's externalId derivation,
 * which yields a complete, correct listing of entirely new keys — under which
 * every stored document is "absent" and every listed one is new.
 *
 * The hold is deliberately all-or-nothing rather than a truncation to the cap:
 * deleting up to the cap still destroys data, and leaves the knowledge base in a
 * state no operator asked for and no later sync can reason about. For the outage
 * shapes above the corpus is left intact and reconciliation resumes as soon as
 * the source returns its full listing. It does NOT self-heal from a hold caused
 * by genuine bulk removal: those deletions stay withheld until a `fullSync`
 * applies them, which is the point — a human confirms them.
 *
 * The two generations are capped SEPARATELY. Soft deletes are this sync's newly
 * absent documents; hard deletes are the previous generation's soft deletes,
 * confirmed absent a second time and therefore already gated by this cap once.
 * Summing them double-counts the older generation and, on a connector with
 * steady churn, ratchets: each sync's new soft deletes plus the prior sync's
 * pending hard deletes exceed the cap, the all-or-nothing hold blocks the hard
 * deletes that would drain the backlog, and the backlog grows monotonically so
 * the connector never reconciles again. Capping each generation against the same
 * ceiling keeps the per-sync blast radius bounded without that deadlock.
 *
 * Note the ceiling this yields: each generation may spend the cap independently,
 * so a single sync can remove up to 2x the cap — with the default ratio, about
 * half the corpus, not a quarter. That is deliberate. The two generations are
 * different populations: the hard deletes were already gated by this cap on the
 * sync that tombstoned them, and have been invisible ever since, so confirming
 * them costs no additional visible documents. The quarter-of-a-corpus figure
 * describes what one sync may newly hide, which is the number that matters for a
 * source that has started lying about its contents.
 *
 * `fullSync` bypasses the cap, matching its meaning everywhere else here — an
 * explicit human request to reconcile against this listing right now, which is
 * the documented escape hatch for a genuine mass deletion.
 */
export function capReconciliationDeletions(
  softDeleteIds: string[],
  hardDeleteIds: string[],
  ownedDocCount: number,
  fullSync: boolean | undefined,
  override?: ReconciliationDeleteCapOverride
): {
  softDeleteIds: string[]
  hardDeleteIds: string[]
  held: boolean
  softHeld: boolean
  hardHeld: boolean
  withheld: number
  cap: number
} {
  const cap = resolveReconciliationDeleteCap(ownedDocCount, override)
  const softHeld = !fullSync && softDeleteIds.length > cap
  const hardHeld = !fullSync && hardDeleteIds.length > cap

  return {
    softDeleteIds: softHeld ? [] : softDeleteIds,
    hardDeleteIds: hardHeld ? [] : hardDeleteIds,
    held: softHeld || hardHeld,
    softHeld,
    hardHeld,
    withheld: (softHeld ? softDeleteIds.length : 0) + (hardHeld ? hardDeleteIds.length : 0),
    cap,
  }
}

/**
 * Reconstructs the previous completed sync's listing from its log counters.
 *
 * Every document the previous run listed landed in exactly one of
 * added/updated/unchanged/skipped/failed, and `lastSyncDocCount` records
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
      previous.docsAdded +
      previous.docsUpdated +
      previous.docsUnchanged +
      previous.docsSkipped +
      previous.docsFailed,
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

/**
 * A stored document's identity, as read back for reconciliation.
 *
 * `userExcluded` is required, not optional. Both reads project it, so the
 * deletion guards in {@link partitionSyncReconciliation} enforce something on
 * their own rather than restating a filter the SQL already applied — if that
 * filter were ever dropped, the guard would still hold. An optional flag made
 * the guard a silent no-op on any read that forgot to select it.
 */
type ReconciliationDoc = { id: string; externalId: string | null; userExcluded: boolean }

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
 *
 * A `userExcluded` document is never deletion-eligible — the user asked to keep
 * the row — but it stays fully resurrection-eligible. The distinction matters:
 * `userExcluded` and `enabled` gate visibility on their own in every retrieval
 * path, so resurrecting one never re-indexes it; it only clears `deletedAt`.
 * Withholding resurrection instead would strand the row permanently, since the
 * connector-document listing and the restore mutation both require
 * `deletedAt IS NULL` — leaving it invisible, unrestorable, and (by this very
 * guard) undeletable.
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
    .filter((d) => d.externalId && !d.userExcluded && !seenExternalIds.has(d.externalId))
    .map((d) => d.id)
  const tombstonedStillMissingIds = tombstonedDocs
    .filter((d) => d.externalId && !d.userExcluded && !seenExternalIds.has(d.externalId))
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
    /**
     * The queue entry this run is allowed to consume. Absent only for tasks
     * queued before the token existed; see {@link ConnectorSyncPayload}.
     */
    dispatchToken?: string
  }
): Promise<SyncResult> {
  const billingAttribution = assertBillingAttributionSnapshot(options?.billingAttribution)
  const result: SyncResult = {
    docsAdded: 0,
    docsUpdated: 0,
    docsDeleted: 0,
    docsUnchanged: 0,
    docsSkipped: 0,
    docsFailed: 0,
    processingDispatch: {
      requested: 0,
      accepted: 0,
      failed: 0,
    },
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
    return { ...result, skipReason: 'connector_unavailable' }
  }

  const connectorBeforeLock = connectorRows[0]

  const connectorConfig = CONNECTOR_REGISTRY[connectorBeforeLock.connectorType]
  if (!connectorConfig) {
    throw new Error(`Unknown connector type: ${connectorBeforeLock.connectorType}`)
  }

  const kbRows = await db
    .select({ userId: knowledgeBase.userId, workspaceId: knowledgeBase.workspaceId })
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.id, connectorBeforeLock.knowledgeBaseId),
        isNull(knowledgeBase.deletedAt)
      )
    )
    .limit(1)

  if (kbRows.length === 0) {
    logger.warn(
      `Skipping sync: knowledge base ${connectorBeforeLock.knowledgeBaseId} is deleted (connector ${connectorId})`
    )
    await db
      .update(knowledgeConnector)
      .set({
        status: 'error',
        nextSyncAt: null,
        lastSyncError: 'Knowledge base deleted',
        /**
         * Clears the lock alongside the status.
         *
         * This write runs BEFORE the lock is taken, but it is unconditional on
         * status, so it can land on a row a previous run left `syncing` — a run
         * that may still be alive. Flipping status without releasing the token
         * left a row that was neither locked nor reclaimable: the reaper only
         * looks at `syncing` rows, and the old run's terminal write could still
         * match its own token and resurrect a state for a knowledge base that no
         * longer exists. Releasing both makes the transition terminal.
         */
        syncLockToken: null,
        syncLockLeaseAt: null,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeConnector.id, connectorId))
    return { ...result, skipReason: 'knowledge_base_deleted' }
  }

  const userId = kbRows[0].userId
  // Resolved once per sync and threaded into add/updateDocument so every synced
  // kb/ object records a trusted ownership binding without an N+1 KB lookup.
  const kbOwner: KnowledgeBaseOwner = { workspaceId: kbRows[0].workspaceId, userId }
  if (!kbOwner.workspaceId) {
    throw new Error(
      `Knowledge base ${connectorBeforeLock.knowledgeBaseId} is missing workspace billing context`
    )
  }
  if (billingAttribution.workspaceId !== kbOwner.workspaceId) {
    throw new Error(
      `Connector sync billing attribution does not match knowledge base workspace ${kbOwner.workspaceId}`
    )
  }
  /**
   * Identifies this run for the terminal writes. Generated before the CAS and
   * written by it, so ownership is established atomically with the lock — and
   * reused as the sync-log row id, which makes the connector row point at the
   * run that holds it.
   */
  const syncLogId = generateId()

  const lockResult = await db
    .update(knowledgeConnector)
    .set(buildSyncLockAcquisition(syncLogId, new Date()))
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        inArray(knowledgeConnector.status, LOCKABLE_CONNECTOR_STATUSES),
        /**
         * Proves this run is consuming the queue entry that was made for it.
         *
         * A task delayed past the lease is reclaimed and replaced, and the
         * status check alone would let that stale task take the replacement's
         * entry — running superseded options (a plain sync where the user had
         * just asked for a full resync) while the replacement is turned away as
         * `sync_in_progress`. Matching the token is the same discipline
         * {@link holdsSyncLockToken} already applies to the `syncing` phase,
         * extended to the phase before it.
         */
        ...(options.dispatchToken
          ? [eq(knowledgeConnector.syncLockToken, options.dispatchToken)]
          : []),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
    .returning()

  if (lockResult.length === 0) {
    /**
     * Distinguishes the two ways the CAS can find no row. Costs one read on a
     * path that already decided not to work, and the alternative is reporting a
     * connector someone paused as a concurrency conflict.
     */
    const [current] = await db
      .select({
        status: knowledgeConnector.status,
        syncLockToken: knowledgeConnector.syncLockToken,
      })
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, connectorId))
      .limit(1)

    /**
     * Status is checked before ownership because pausing a queued connector
     * releases its token, so a mismatch is the *symptom* there and the status is
     * the actual reason. Testing ownership first would report every
     * pause-while-queued — the common case — as a superseded dispatch, losing
     * the distinction this branch exists to draw.
     */
    if (current?.status === 'paused' || current?.status === 'disabled') {
      logger.info('Connector is not accepting syncs, skipping', {
        connectorId,
        status: current.status,
      })
      return { ...result, skipReason: 'connector_not_syncable' }
    }

    if (options.dispatchToken && current?.syncLockToken !== options.dispatchToken) {
      logger.info('Sync superseded by a newer dispatch, skipping', { connectorId })
      return { ...result, skipReason: 'dispatch_superseded' }
    }

    logger.info('Sync already in progress, skipping', { connectorId })
    return { ...result, skipReason: 'sync_in_progress' }
  }

  /**
   * The row returned by the lock is the authoritative sync snapshot. A source update
   * committed before the lock is included here; one attempted after it sees `syncing`
   * and conflicts instead of letting this worker process stale configuration.
   */
  const connector = lockResult[0]
  const sourceConfig = connector.sourceConfig as Record<string, unknown>
  const syncStartedAt = new Date()
  /** Seeded at lock acquisition, which wrote `updatedAt` itself. */
  let lastHeartbeatAtMs = Date.now()

  /**
   * Refreshes the lock if the interval has elapsed, and aborts the run if it has
   * been reclaimed. Called at the top of every unbounded loop in this sync — the
   * time gate makes each call nearly free, so placement only has to guarantee
   * that no unbounded phase runs without reaching one.
   */
  const beatIfDue = async (): Promise<void> => {
    if (!shouldHeartbeatSyncLock(Date.now(), lastHeartbeatAtMs)) return
    if (!(await heartbeatSyncLock(connectorId, syncLogId))) {
      throw new SyncLockLostException(connectorId)
    }
    lastHeartbeatAtMs = Date.now()
  }
  await db.insert(knowledgeConnectorSyncLog).values({
    id: syncLogId,
    connectorId,
    status: 'started',
    startedAt: syncStartedAt,
  })

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
    let retainedSourcePayloadBytes = 0
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
      /**
       * Listing is where a large source spends most of its wall clock — the
       * batch loop below does not start until every page has been fetched — so
       * without this a big listing outran the TTL and was reclaimed as a hard
       * failure, which is the exact ratchet the heartbeat exists to prevent.
       */
      await beatIfDue()

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
      if (page.reconciliationSafe === false) {
        syncContext.reconciliationUnsafe = true
      }
      if (!sourcePageFitsSyncWorkingSet(externalDocs.length, page.documents.length)) {
        throw new ConnectorSyncWorkingSetLimitError(connectorId, 'source listing')
      }
      retainedSourcePayloadBytes = addSourcePagePayloadBytes(
        retainedSourcePayloadBytes,
        page.documents
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

    /**
     * Loaded sequentially with a shared sentinel budget. Three concurrent
     * `SELECT`s each capped independently could still materialize three times
     * the intended working set before the overflow was detected.
     */
    const existingDocs = await db
      .select({
        id: document.id,
        externalId: document.externalId,
        contentHash: document.contentHash,
        storageKey: document.storageKey,
        /**
         * Projected as well as filtered: the SQL predicate and the in-memory guard in
         * partitionSyncReconciliation must both hold, so dropping either one alone cannot make
         * an excluded document deletable.
         */
        userExcluded: document.userExcluded,
      })
      .from(document)
      .where(
        and(
          eq(document.connectorId, connectorId),
          /**
           * A user's explicit "keep but don't index" choice must never make a document eligible
           * for reconciliation deletion: it is deliberately never refreshed, so its absence from
           * a listing says nothing.
           */
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )
      .limit(syncWorkingSetQueryLimit(0))
    assertSyncWorkingSetWithinLimit(connectorId, 0, existingDocs.length)

    /**
     * Documents already marked pending-removal by a prior sync's reconciliation: absent from the
     * source once, not yet absent twice in a row. Including them in classification lets a document
     * that reappears be recognized as existing (resurrected) rather than re-added.
     */
    const tombstonedDocs = await db
      .select({
        id: document.id,
        externalId: document.externalId,
        contentHash: document.contentHash,
        storageKey: document.storageKey,
        deletedAt: document.deletedAt,
        /**
         * Gates hard deletion in partitionSyncReconciliation without gating resurrection.
         */
        userExcluded: document.userExcluded,
      })
      .from(document)
      .where(
        and(
          eq(document.connectorId, connectorId),
          /**
           * Load both included and user-excluded tombstones. Excluded tombstones are never
           * deletion-eligible, but they must remain resurrection-eligible when their source
           * document reappears or the row becomes permanently invisible and unrestorable.
           */
          isNull(document.archivedAt),
          isNotNull(document.deletedAt)
        )
      )
      .limit(syncWorkingSetQueryLimit(existingDocs.length))
    assertSyncWorkingSetWithinLimit(connectorId, existingDocs.length, tombstonedDocs.length)

    /**
     * Live user-excluded rows form the third disjoint population in the shared memory budget.
     * User-excluded tombstones were loaded above so source presence can clear their deletion marker;
     * they are added to `excludedExternalIds` below to keep hydration short-circuited.
     */
    const loadedOwnedDocs = existingDocs.length + tombstonedDocs.length
    const excludedDocs = await db
      .select({ externalId: document.externalId })
      .from(document)
      .where(
        and(
          eq(document.connectorId, connectorId),
          eq(document.userExcluded, true),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )
      .limit(syncWorkingSetQueryLimit(loadedOwnedDocs))
    assertSyncWorkingSetWithinLimit(connectorId, loadedOwnedDocs, excludedDocs.length)

    const excludedExternalIds = new Set(
      [
        ...excludedDocs.map((doc) => doc.externalId),
        ...tombstonedDocs.filter((doc) => doc.userExcluded).map((doc) => doc.externalId),
      ].filter((externalId): externalId is string => Boolean(externalId))
    )

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
          pendingOps.push({
            type: 'skip',
            existingId: classification.existingId,
            extDoc,
          })
          break
        case 'drop':
          // Empty, non-deferred content is never usable. If this was a
          // reappearing tombstoned document, its content was never verified as
          // current — see failedExternalIds below.
          if (existing) {
            recordUnverifiedExistingRefresh(result, failedExternalIds, extDoc.externalId)
          }
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
          if (extDoc.skippedReason && existing) {
            recordUnverifiedExistingRefresh(result, failedExternalIds, extDoc.externalId)
          } else {
            result.docsUnchanged++
          }
          break
      }
    }

    // Batch by both count and summed content bytes so a few large files near the
    // per-file cap never hydrate/upload together and exhaust the worker heap.
    const batches = chunkOpsByByteBudget(pendingOps, CONTENT_INFLIGHT_BUDGET_BYTES, SYNC_BATCH_SIZE)
    for (const rawBatch of batches) {
      const presence = await checkSyncTargetPresence(connectorId, connector.knowledgeBaseId)
      if (presence.connectorDeleted) {
        throw new ConnectorDeletedException(connectorId)
      }
      if (presence.knowledgeBaseDeleted) {
        throw new Error(`Knowledge base ${connector.knowledgeBaseId} was deleted during sync`)
      }

      // After liveness: a deleted connector must raise ConnectorDeletedException
      // and run its cleanup, not be reported as a lost lock.
      await beatIfDue()

      // Oversized/skipped docs become visible `failed` rows (never silent). They are
      // flagged either at listing time (skip ops here) or discovered only at fetch
      // time during hydration below; both are collected and persisted after hydration.
      const skipOps = rawBatch.filter((op) => op.type === 'skip')
      const skippedRetryHashUpdates: Array<{
        existingId: string
        externalId: string
        contentHash: string
      }> = []

      const contentOps = rawBatch.filter((op) => op.type !== 'skip')
      const deferredOps = contentOps.filter((op) => op.extDoc.contentDeferred)
      const readyOps = contentOps.filter((op) => !op.extDoc.contentDeferred)

      if (deferredOps.length > 0) {
        if (connectorConfig.auth.mode === 'oauth') {
          accessToken = await resolveAccessToken(connector, connectorConfig, credentialUserId)
        }

        const hydrated = await Promise.allSettled(
          deferredOps.map(async (op) => {
            const fullDoc = requireHydratedListedDocument(
              await connectorConfig.getDocument(
                accessToken!,
                sourceConfig,
                op.extDoc.externalId,
                syncContext
              ),
              op.extDoc.externalId
            )
            // A connector may only learn a file is too large at fetch time (its
            // listing has no size). Surface that as a failed row for new files; keep
            // already-indexed files as last-known-good rather than downgrading them.
            if (fullDoc?.skippedReason) {
              if (op.type === 'add') {
                skipOps.push({
                  type: 'skip',
                  extDoc: mergeHydratedSkippedDocument(op.extDoc, fullDoc),
                })
              } else if (op.type === 'update') {
                if (fullDoc.skippedExistingDisposition === 'replace') {
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
              if (op.type === 'update') {
                recordUnverifiedExistingRefresh(result, failedExternalIds, op.extDoc.externalId)
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

      if (skippedRetryHashUpdates.length > 0) {
        try {
          const missedExternalIds = await persistSkippedRetryHashes(
            connector.knowledgeBaseId,
            connectorId,
            skippedRetryHashUpdates
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

      // Record all skipped (oversized) docs in this batch in one bulk insert.
      if (skipOps.length > 0) {
        try {
          const recorded = await persistSkippedDocuments(
            connector.knowledgeBaseId,
            connectorId,
            connector.connectorType,
            skipOps,
            sourceConfig
          )
          result.docsSkipped += recorded
        } catch (error) {
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
        result.processingDispatch.requested += batchDocs.length
        try {
          const dispatch = await processDocumentsWithQueue(
            batchDocs,
            connector.knowledgeBaseId,
            {},
            generateId(),
            billingAttribution
          )
          result.processingDispatch.accepted += dispatch.accepted
          result.processingDispatch.failed += dispatch.failed
        } catch (error) {
          result.processingDispatch.failed += batchDocs.length
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
    /**
     * Counted over deletion-eligible rows on both sides. The live read filters
     * excluded documents in SQL; the tombstoned read only projects the flag, so
     * excluded tombstones must be dropped here or they inflate a denominator
     * governing a population they are not part of. Matches `listedDocCount`,
     * which `countNonExcludedListed` already puts on the same footing.
     */
    const ownedDocCount = countDeletionEligibleOwned(existingDocs, tombstonedDocs)
    /**
     * Counted over the same population as `ownedDocCount`: excluded documents
     * are absent from the live read, so they must not inflate the numerator.
     */
    const listedDocCount = countNonExcludedListed(seenExternalIds, excludedExternalIds)
    if (reconcileDeletionsAllowed && classifySuspectListing(listedDocCount, ownedDocCount)) {
      const previousObservation = await loadPreviousListingObservation(
        connectorId,
        syncLogId,
        resolvePreviousOwnedCount(connector.lastSyncDocCount, ownedDocCount),
        !connectorConfig.supportsIncrementalSync || connector.syncMode === 'full'
      )
      const listingSafety = evaluateListingSafety(
        listedDocCount,
        ownedDocCount,
        previousObservation,
        options?.fullSync
      )
      logger.warn('Suspect connector listing detected', {
        connectorId,
        connectorType: connector.connectorType,
        reason: listingSafety.reason,
        listedDocs: listedDocCount,
        listedDocsIncludingExcluded: seenExternalIds.size,
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

    /**
     * Last word after every shape guard: even a listing that looks entirely
     * healthy may not remove an implausible share of the corpus in one pass.
     * Applied here so it covers both the soft-delete UPDATE and the
     * `hardDeleteDocuments` call below.
     */
    const capped = capReconciliationDeletions(
      reconcileDeletionsAllowed ? softDeleteIds : [],
      reconcileDeletionsAllowed ? hardDeleteIds : [],
      ownedDocCount,
      options?.fullSync
    )
    /**
     * Surfaced on the connector so a held pass is visible to an operator rather
     * than only in logs: without it the sync completes green, clears
     * `lastSyncError`, and source-removed documents stay indexed with no signal.
     * Written through the success update at the end of this run rather than
     * here — that update sets `lastSyncError: null` unconditionally and would
     * otherwise clobber this within the same sync. `status` is deliberately left
     * `active`: the sync itself succeeded, and marking the connector broken
     * would stop it syncing at all.
     */
    let reconciliationHoldNotice: string | null = null
    if (capped.held) {
      reconciliationHoldNotice = buildReconciliationHoldNotice(
        capped.withheld,
        capped.cap,
        ownedDocCount,
        capped.softHeld,
        capped.hardHeld
      )
      logger.error('Reconciliation deletions held — exceeds per-sync blast-radius cap', {
        connectorId,
        connectorType: connector.connectorType,
        withheld: capped.withheld,
        softHeld: capped.softHeld,
        hardHeld: capped.hardHeld,
        requestedSoft: softDeleteIds.length,
        requestedHard: hardDeleteIds.length,
        cap: capped.cap,
        ownedDocCount,
        listedCount: listedDocCount,
        syncRunId: syncContext.syncRunId,
      })
    }

    const gatedSoftDeleteIds = capped.softDeleteIds
    const gatedHardDeleteIds = capped.hardDeleteIds

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
        const [activeKnowledgeBase] = await tx
          .select({ id: knowledgeBase.id })
          .from(knowledgeBase)
          .where(
            and(eq(knowledgeBase.id, connector.knowledgeBaseId), isNull(knowledgeBase.deletedAt))
          )
          .for('update')
        if (!activeKnowledgeBase) throw new SyncLockLostException(connectorId)

        const [heldSyncLock] = await tx
          .select({ id: knowledgeConnector.id })
          .from(knowledgeConnector)
          .where(stillHoldsSyncLock(connectorId, syncLogId))
          .for('update')
        if (!heldSyncLock) throw new SyncLockLostException(connectorId)

        const stillOwned = new Set(
          (
            await tx
              .select({ id: document.id })
              .from(document)
              .where(
                and(
                  inArray(document.id, candidateIds),
                  eq(document.connectorId, connectorId),
                  isNull(document.archivedAt)
                )
              )
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
            .where(
              and(
                inArray(document.id, safeResurrectIds),
                eq(document.connectorId, connectorId),
                isNull(document.archivedAt),
                isNotNull(document.deletedAt)
              )
            )
        }
        if (safeSoftDeleteIds.length > 0) {
          await tx
            .update(document)
            .set({ deletedAt: new Date() })
            .where(
              and(
                inArray(document.id, safeSoftDeleteIds),
                eq(document.connectorId, connectorId),
                eq(document.userExcluded, false),
                isNull(document.archivedAt),
                isNull(document.deletedAt)
              )
            )
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
    for (let i = 0; i < safeHardDeleteIds.length; i += HARD_DELETE_CHUNK_SIZE) {
      await beatIfDue()
      try {
        result.docsDeleted += await hardDeleteDocuments(
          safeHardDeleteIds.slice(i, i + HARD_DELETE_CHUNK_SIZE),
          syncLogId,
          connectorId,
          connector.knowledgeBaseId,
          {
            connectorId,
            knowledgeBaseId: connector.knowledgeBaseId,
            syncLockToken: syncLogId,
          }
        )
      } catch (error) {
        if (error instanceof ConnectorSyncDeletionGuardError) {
          throw new SyncLockLostException(connectorId)
        }
        throw error
      }
    }

    const postBatchPresence = await checkSyncTargetPresence(connectorId, connector.knowledgeBaseId)
    if (postBatchPresence.connectorDeleted) {
      throw new ConnectorDeletedException(connectorId)
    }
    if (postBatchPresence.knowledgeBaseDeleted) {
      throw new Error(`Knowledge base ${connector.knowledgeBaseId} was deleted during sync`)
    }

    /**
     * Reclaims documents this connector left unfinished: a terminated attempt, a
     * dispatch that never produced a run, or a run abandoned mid-processing.
     *
     * The query applies each status's age rule before the candidate limit, so
     * recently requeued old uploads cannot hide genuinely overdue work. The same
     * rules are evaluated again after candidate rows are locked below. Skipped
     * documents are content-less `failed` rows with no storage key and therefore
     * remain excluded outright.
     */
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
          // Dead letters are left alone: past the budget, re-dispatching only
          // re-bills a document that has failed the same way every time.
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

    if (stuckDocs.length > 0) {
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
            .where(
              and(eq(knowledgeBase.id, connector.knowledgeBaseId), isNull(knowledgeBase.deletedAt))
            )
            .for('update')
          if (!activeKnowledgeBase) throw new SyncLockLostException(connectorId)

          const [heldSyncLock] = await tx
            .select({ id: knowledgeConnector.id })
            .from(knowledgeConnector)
            .where(stillHoldsSyncLock(connectorId, syncLogId))
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
                  lt(document.processingAttempts, MAX_PROCESSING_ATTEMPTS),
                  eq(document.userExcluded, false),
                  isNotNull(document.storageKey),
                  isNull(document.archivedAt),
                  isNull(document.deletedAt)
                )
              )
              .returning({ id: document.id })

            // Embeddings are dropped only for documents this sweep actually
            // reset. Deleting first would strip a pass that completed between
            // the candidate SELECT and this write.
            const resetIds = reset.map((row) => row.id)
            if (resetIds.length > 0) {
              await tx.delete(embedding).where(inArray(embedding.documentId, resetIds))
            }
            const resetIdSet = new Set(resetIds)
            retryDocs = retryDocs.filter((doc) => resetIdSet.has(doc.id))
          }
        })

        for (let i = 0; i < retryDocs.length; i += STUCK_RETRY_DISPATCH_CHUNK_SIZE) {
          if (!(await heartbeatLiveSyncLock(connectorId, syncLogId))) {
            throw new SyncLockLostException(connectorId)
          }
          lastHeartbeatAtMs = Date.now()

          const retryChunk = retryDocs.slice(i, i + STUCK_RETRY_DISPATCH_CHUNK_SIZE)
          result.processingDispatch.requested += retryChunk.length
          const dispatch = await processDocumentsWithQueue(
            retryChunk.map((doc) => ({
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

    const completionLanded = await completeSuccessfulSync(
      connectorId,
      connector.knowledgeBaseId,
      syncLogId,
      connector.syncIntervalMinutes,
      result,
      reconciliationHoldNotice
    )

    if (!completionLanded) {
      logger.warn('Sync result discarded — connector was reclaimed while this run was executing', {
        connectorId,
        syncLogId,
        ...result,
      })
      return markSyncSuperseded(result)
    }

    logger.info('Sync completed', { connectorId, ...result })
    return result
  } catch (error) {
    if (error instanceof SyncLockLostException) {
      /**
       * Reported as superseded rather than failed, and deliberately writes
       * nothing: the connector row belongs to whoever reclaimed it, and this
       * run's own sync-log row was closed by the sweep that did so.
       */
      logger.warn('Sync abandoned — lock was reclaimed while this run was executing', {
        connectorId,
        syncLogId,
        ...result,
      })
      return markSyncSuperseded(result)
    }

    if (error instanceof ConnectorDeletedException) {
      logger.info('Connector deleted during sync, cleaning up', { connectorId })

      try {
        await releaseSyncLockOnDeletedConnector(connectorId, syncLogId)

        /**
         * Includes pending-removal tombstones. Page IDs so deleting a connector
         * with a legacy corpus above the sync admission cap cannot materialize
         * the entire corpus in the cleanup worker.
         */
        let afterDocumentId: string | undefined
        while (true) {
          const connectorDocs = await db
            .select({ id: document.id })
            .from(document)
            .where(
              and(
                eq(document.connectorId, connectorId),
                isNull(document.archivedAt),
                afterDocumentId ? gt(document.id, afterDocumentId) : undefined
              )
            )
            .orderBy(asc(document.id))
            .limit(CONNECTOR_DELETION_CLEANUP_BATCH_SIZE)
          if (connectorDocs.length === 0) break

          await hardDeleteDocuments(
            connectorDocs.map((doc) => doc.id),
            syncLogId,
            connectorId
          )
          afterDocumentId = connectorDocs.at(-1)?.id
          if (connectorDocs.length < CONNECTOR_DELETION_CLEANUP_BATCH_SIZE) break
        }

        await completeSyncLog(syncLogId, 'failed', result, {
          errorMessage: 'Connector deleted during sync',
        })
      } catch (cleanupError) {
        logger.error('Failed to clean up after connector deletion', {
          connectorId,
          error: toError(cleanupError).message,
        })
      }

      result.skipReason = 'connector_deleted_during_sync'
      return result
    }

    const errorMessage = toError(error).message
    logger.error('Sync failed', { connectorId, error: errorMessage })

    try {
      await completeSyncLog(syncLogId, 'failed', result, { errorMessage })

      const failureUpdate =
        error instanceof ConnectorSyncCapacityError
          ? buildSyncCapacityUpdate(new Date(), connector.consecutiveFailures, errorMessage)
          : buildSyncFailureUpdate(new Date(), connector.consecutiveFailures, errorMessage)

      if (failureUpdate.status === 'disabled') {
        logger.warn('Connector disabled after repeated failures', {
          connectorId,
          consecutiveFailures: failureUpdate.consecutiveFailures,
        })
      }

      const failureWriteLanded = await writeTerminalConnectorState(
        connectorId,
        syncLogId,
        failureUpdate
      )

      /**
       * Deliberately does NOT get {@link markSyncSuperseded}. `result.error`
       * is set to the real failure cause below, so replacing it with lifecycle
       * control flow would destroy the diagnostic. The supersession is carried
       * by this log line instead.
       */
      if (!failureWriteLanded) {
        logger.warn(
          'Sync failure discarded — connector was reclaimed while this run was executing',
          { connectorId, syncLogId, error: errorMessage }
        )
      }
    } catch (recoveryError) {
      logger.error('Failed to record sync failure', {
        connectorId,
        error: toError(recoveryError).message,
      })
    }

    result.error = errorMessage
    return result
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
