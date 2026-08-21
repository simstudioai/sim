/**
 * Dispatches the stuck-document sweep will spend on one document before giving
 * up on it.
 *
 * The sweep re-dispatches a non-terminal document every sync for the whole
 * retry window, and every dispatch re-parses and re-embeds it — so a document
 * that fails deterministically (a corrupt file, an unsupported encoding) was
 * billed once per sync indefinitely. Five is chosen against the unit that is
 * actually consumed: one attempt per *dispatch*, not per Trigger.dev retry, so
 * a short-interval connector can burn several inside one transient outage.
 * Three left too little room for that; five still bounds the spend well inside
 * `RETRY_WINDOW_DAYS`.
 *
 * Reaching it is a dead letter, not a deletion: the document keeps its `failed`
 * status and stays user-retryable, it simply stops being swept automatically.
 */
export const MAX_PROCESSING_ATTEMPTS = 5

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
