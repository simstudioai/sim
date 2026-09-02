/**
 * `pg_trgm` can only extract a trigram from three consecutive characters, so a
 * shorter query has nothing for the segment GIN index to probe and degrades to a
 * scan of every tenant's segments. It bounds the literal query length and, in
 * regex mode, the shortest literal run every match is guaranteed to contain.
 */
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

/**
 * Backstop for a pattern whose trigrams the planner cannot use — a punctuation-only
 * or non-ASCII literal, or a regex whose guaranteed run yields no trigram. Those
 * plan as a sequential scan across every workspace's segments, so the search must
 * not be able to hold a pooled connection open indefinitely.
 */
export const FILE_SEARCH_STATEMENT_TIMEOUT_MS = 10 * 1000
export const FILE_SEARCH_LOCK_TIMEOUT_MS = 5 * 1000
export const FILE_SEARCH_DEFAULT_MAX_RESULTS = 50
export const FILE_SEARCH_MAX_RESULTS = 200

export const FILE_SEARCH_MAX_SOURCE_BYTES = 25 * 1024 * 1024
export const FILE_SEARCH_MAX_EXTRACTED_BYTES = 25 * 1024 * 1024
export const FILE_SEARCH_MAX_PREVIEW_BYTES = 2 * 1024
export const FILE_SEARCH_SEGMENT_CHARS = 16 * 1024
export const FILE_SEARCH_SEGMENT_OVERLAP_CHARS =
  FILE_SEARCH_MAX_QUERY_LENGTH + FILE_SEARCH_MAX_PREVIEW_BYTES
export const FILE_SEARCH_INSERT_BATCH_ROWS = 250
export const FILE_SEARCH_INSERT_BATCH_BYTES = 1024 * 1024

export const FILE_SEARCH_INDEX_GLOBAL_CONCURRENCY = 10
export const FILE_SEARCH_INDEX_WORKSPACE_OUTSTANDING = 2
export const FILE_SEARCH_INDEX_MAX_OUTSTANDING = 100
export const FILE_SEARCH_INDEX_DISPATCH_WORKSPACES = 100
export const FILE_SEARCH_DISPATCH_INTERVAL_MS = 60 * 1000
export const FILE_SEARCH_DISPATCH_MAX_DURATION_SECONDS = 60
export const FILE_SEARCH_INDEX_MAX_DURATION_SECONDS = 15 * 60
export const FILE_SEARCH_INDEX_STALE_DISPATCH_MS = 6 * 60 * 60 * 1000
export const FILE_SEARCH_INDEX_STALE_REAP_LIMIT = 100
export const FILE_SEARCH_BACKFILL_PAGE_SIZE = 1000
