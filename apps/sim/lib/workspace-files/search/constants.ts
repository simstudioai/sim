/** Require enough literal characters for a selective trigram probe when the pattern permits one. */
export const FILE_SEARCH_MIN_QUERY_LENGTH = 3
export const FILE_SEARCH_MAX_QUERY_LENGTH = 512

/**
 * Caps the analyzer's bookkeeping strings so a bounded repeat cannot expand a
 * short pattern into a large intermediate. Only {@link FILE_SEARCH_MIN_QUERY_LENGTH}
 * characters are ever needed, so truncating past this loses no decision.
 */
export const FILE_SEARCH_PATTERN_LITERAL_CAP = 512
export const FILE_SEARCH_PATTERN_MAX_REPEAT = 1000
export const FILE_SEARCH_PATTERN_MAX_DEPTH = 20

/** Total search deadline, including patterns whose literals cannot provide a selective trigram probe. */
export const FILE_SEARCH_STATEMENT_TIMEOUT_MS = 10 * 1000
export const FILE_SEARCH_LOCK_TIMEOUT_MS = 5 * 1000
export const FILE_SEARCH_DEFAULT_MAX_RESULTS = 50
export const FILE_SEARCH_MAX_RESULTS = 200

export const FILE_SEARCH_MAX_SOURCE_BYTES = 25 * 1024 * 1024
export const FILE_SEARCH_MAX_EXTRACTED_BYTES = 25 * 1024 * 1024
/**
 * Unbroken base64-alphabet runs at least this long are encoded payloads (data URIs, binaries
 * stored as base64 text), not searchable text. Each chunk of one yields thousands of distinct
 * rare trigrams, which makes its direct GIN insert far slower than ordinary text.
 */
export const FILE_SEARCH_ENCODED_RUN_MIN_CHARS = 256
/** Text is excluded when encoded runs are at least this share of it... */
export const FILE_SEARCH_ENCODED_EXCLUSION_RATIO = 0.5
/** ...and span more than a few chunks, so a small config carrying one signature stays searchable. */
export const FILE_SEARCH_ENCODED_EXCLUSION_MIN_BYTES = 32 * 1024
export const FILE_SEARCH_MAX_PREVIEW_BYTES = 2 * 1024
export const FILE_SEARCH_CHUNK_BYTES = 8 * 1024
export const FILE_SEARCH_CANDIDATE_PAGE_SIZE = 16
export const FILE_SEARCH_CANDIDATE_PROBE_SIZE = 256
export const FILE_SEARCH_QUERY_GLOBAL_CONCURRENCY = 5000
export const FILE_SEARCH_QUERY_WORKSPACE_CONCURRENCY = 20
export const FILE_SEARCH_QUEUE_MAX_PENDING = 100
export const FILE_SEARCH_QUEUE_TIMEOUT_MS = 5000
export const FILE_SEARCH_CANDIDATE_LITERAL_CHARS = 3
export const FILE_SEARCH_BUILD_LEASE_MS = 20 * 60 * 1000
export const FILE_SEARCH_CLEANUP_BATCH_ROWS = 1000
export const FILE_SEARCH_CLEANUP_BATCH_BUILDS = 100
export const FILE_SEARCH_CLEANUP_BACKLOG_ROWS = 10000
export const FILE_SEARCH_CLEANUP_MAX_BATCHES = 10
export const FILE_SEARCH_CLEANUP_BUDGET_MS = 5000
/**
 * One batch's nominal share of the run budget, and so the smallest slice worth starting another
 * with.
 *
 * Running out of budget is how cleanup normally ends. A batch admitted with less than its share
 * either runs past the budget it was given or aborts on its own statement timeout, which the caller
 * reports as a cleanup failure rather than as work still to do.
 */
export const FILE_SEARCH_CLEANUP_MIN_BATCH_MS =
  FILE_SEARCH_CLEANUP_BUDGET_MS / FILE_SEARCH_CLEANUP_MAX_BATCHES
export const FILE_SEARCH_RECONCILE_INTERVAL_MS = 60 * 60 * 1000
export const FILE_SEARCH_INSERT_BATCH_ROWS = 250
/** Direct GIN writes perform index work in each insert, so transactions use smaller byte batches. */
export const FILE_SEARCH_INSERT_BATCH_BYTES = 128 * 1024
/** Batches at least this slow are logged with their estimated trigram key count. */
export const FILE_SEARCH_SLOW_INSERT_BATCH_MS = 2000

/** Index writes allow statement cancellation before the outer transaction terminates its session. */
export const FILE_SEARCH_INDEX_TRANSACTION_LIMITS = {
  statementTimeout: 10 * 1000,
  lockTimeout: 5 * 1000,
  transactionTimeout: 30 * 1000,
} as const

export const FILE_SEARCH_INDEX_GLOBAL_CONCURRENCY = 10
export const FILE_SEARCH_INDEX_WORKSPACE_OUTSTANDING = 2
export const FILE_SEARCH_INDEX_MAX_OUTSTANDING = 100
export const FILE_SEARCH_INDEX_DISPATCH_WORKSPACES = 100
export const FILE_SEARCH_DISPATCH_INTERVAL_MS = 60 * 1000
export const FILE_SEARCH_DISPATCH_MAX_DURATION_SECONDS = 60
/** Leave room for connection setup, rollback, and task failure reporting before the hard cutoff. */
export const FILE_SEARCH_DISPATCH_STATEMENT_TIMEOUT_MS = 10 * 1000
export const FILE_SEARCH_DISPATCH_LOCK_TIMEOUT_MS = 2 * 1000
export const FILE_SEARCH_DISPATCH_TRANSACTION_TIMEOUT_MS = 20 * 1000
export const FILE_SEARCH_INDEX_MAX_DURATION_SECONDS = 15 * 60
export const FILE_SEARCH_INDEX_STALE_DISPATCH_MS = 6 * 60 * 60 * 1000
export const FILE_SEARCH_INDEX_STALE_REAP_LIMIT = 100
export const FILE_SEARCH_BACKFILL_PAGE_SIZE = 1000
