/**
 * Dispatches the stuck-document sweep will spend on one document before giving
 * up on it.
 *
 * The sweep re-dispatches a non-terminal document every sync for the whole
 * retry window, and every dispatch re-parses and re-embeds it — so a document
 * that fails deterministically (a corrupt file, an unsupported encoding) was
 * billed once per sync indefinitely. Five is chosen against the unit that is
 * actually consumed: one attempt per *dispatch*, not per Trigger.dev retry, so
 * a short-interval connector can still burn several inside one transient
 * outage. A dispatch that provably reached nothing is refunded — see
 * `clearDocumentsQueued` — which refunds each newly claimed dispatch that
 * provably failed before processing began. An accepted dispatch whose remote
 * run never starts still stays charged. Three left too little room for those;
 * five still bounds the spend
 * well inside `RETRY_WINDOW_DAYS`.
 *
 * Reaching it is a dead letter, not a deletion: the document keeps its `failed`
 * status and stays user-retryable, it simply stops being swept automatically.
 */
export const MAX_PROCESSING_ATTEMPTS = 5

/**
 * Grace period a document that is merely *queued* gets before either recovery
 * path may take it: the connector sweep's reclaim, and the user-facing retry.
 *
 * `STALE_PROCESSING_MINUTES` bounds a run that has already begun, derived from
 * the task's own duration and retry budget. Queue *wait* is a different
 * quantity: it is backlog / concurrency, not run duration.
 * `document-processing-queue` has a global concurrency shared by every
 * workspace, so a corpus large enough to approach
 * `CONNECTOR_SYNC_MAX_DURATION_SECONDS` enqueues thousands of documents that
 * drain in waves of that width — at roughly a minute of occupancy each, a few
 * hours, and longer while other workspaces hold slots.
 *
 * Four hours is chosen against three bounds that are all constants in this
 * repository rather than any one deployment's corpus: it is well above that
 * drain estimate, an order of magnitude above the one-hour sync ceiling, and
 * still well under the 1,440-minute default sync interval — so a
 * default-configured connector waits no longer for recovery than it already did.
 *
 * Shared rather than owned by the sweep because both recovery paths have to
 * agree on when a queued dispatch is certainly lost. A retry that admitted a
 * `pending` document sooner would re-dispatch one still waiting its turn and
 * bill a second indexing pass — the double-billing the terminal-only guard was
 * added to close.
 */
export const QUEUED_DISPATCH_GRACE_MS = 240 * 60 * 1000

/** Worst-case wall clock for one processing run across its retry budget. */
export function worstCaseProcessingMinutes(
  maxDurationSeconds: number,
  maxAttempts: number
): number {
  return (maxDurationSeconds * maxAttempts) / 60
}

/** Headroom over the worst case, so ordinary jitter never reclaims a live run. */
const STALE_PROCESSING_HEADROOM = 1.5

/** Floor preserving the historical safe value at the default task settings. */
const STALE_PROCESSING_FLOOR_MINUTES = 45

/**
 * Minutes a `processing` document is given before it can be considered
 * abandoned. Never below the worst case a legitimate retrying run can take.
 */
export function resolveStaleProcessingMinutes(
  maxDurationSeconds: number,
  maxAttempts: number
): number {
  return Math.max(
    STALE_PROCESSING_FLOOR_MINUTES,
    Math.ceil(
      worstCaseProcessingMinutes(maxDurationSeconds, maxAttempts) * STALE_PROCESSING_HEADROOM
    )
  )
}

/**
 * Every value `document.processing_status` may hold.
 *
 * Shared rather than redeclared per consumer so a switch over it can be
 * exhaustive: a `default` arm silently absorbs a status added later, which for
 * the stuck-document sweep meant a new state would read as "not eligible" and
 * quietly stop being reclaimed. With the union imported and no `default`, adding
 * a member fails type-check at every decision site instead.
 */
export const DOCUMENT_PROCESSING_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
] as const

export type DocumentProcessingStatus = (typeof DOCUMENT_PROCESSING_STATUSES)[number]

/**
 * Narrows a stored `processing_status` onto the union.
 *
 * The column is `text`, so every read arrives as `string` no matter how the
 * query filters it. Narrowing at the read boundary keeps the decision sites
 * exhaustive without a cast asserting something the type system cannot see.
 */
export function isDocumentProcessingStatus(value: string): value is DocumentProcessingStatus {
  return (DOCUMENT_PROCESSING_STATUSES as readonly string[]).includes(value)
}

export type DocumentSortField =
  | 'filename'
  | 'fileSize'
  | 'tokenCount'
  | 'chunkCount'
  | 'uploadedAt'
  | 'processingStatus'
  | 'enabled'
export type SortOrder = 'asc' | 'desc'

interface DocumentSortOptions {
  sortBy?: DocumentSortField
  sortOrder?: SortOrder
}

interface HeaderInfo {
  /** Header text */
  text: string
  /** Header level (1-6) */
  level: number
  /** Anchor link */
  anchor: string
  /** Position in document */
  position: number
}
