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
export const FILE_SEARCH_MAX_PREVIEW_BYTES = 2 * 1024
export const FILE_SEARCH_CHUNK_BYTES = 8 * 1024
export const FILE_SEARCH_CANDIDATE_PAGE_SIZE = 16
export const FILE_SEARCH_CANDIDATE_PROBE_SIZE = 256
export const FILE_SEARCH_QUERY_GLOBAL_CONCURRENCY = 10
export const FILE_SEARCH_QUERY_WORKSPACE_CONCURRENCY = 2
export const FILE_SEARCH_CANDIDATE_LITERAL_CHARS = 3
export const FILE_SEARCH_BUILD_LEASE_MS = 20 * 60 * 1000
export const FILE_SEARCH_CLEANUP_BATCH_ROWS = 1000
export const FILE_SEARCH_CLEANUP_BATCH_BUILDS = 100
export const FILE_SEARCH_CLEANUP_BACKLOG_ROWS = 10000
export const FILE_SEARCH_CLEANUP_MAX_BATCHES = 10
export const FILE_SEARCH_CLEANUP_BUDGET_MS = 5000
export const FILE_SEARCH_RECONCILE_INTERVAL_MS = 60 * 60 * 1000
export const FILE_SEARCH_INSERT_BATCH_ROWS = 250
export const FILE_SEARCH_INSERT_BATCH_BYTES = 1024 * 1024

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
