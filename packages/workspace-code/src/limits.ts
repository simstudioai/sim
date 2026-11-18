/**
 * The limits workspace source shares across reading and writing. A get skips what an apply would
 * refuse (a blob over `maxBlobBytes`, or a resource that would take the directory past
 * `maxDeclarationBytes`, `maxDirectoryWorkflowBytes` or `maxBlobs`, is listed in
 * `.sim/skipped.json`), so anything a get writes
 * can be applied back unchanged. One workflow keeps its own `SOURCE_LIMITS`.
 *
 * Client-safe: no parser imports, so contracts and the CLI can read it.
 */
export const WORKSPACE_SOURCE_LIMITS = {
  /** Resources of one kind in one directory. */
  maxResourcesPerKind: 500,
  /** UTF-8 bytes of every declaration file together (workflow files excluded). */
  maxDeclarationBytes: 2_000_000,
  /** UTF-8 bytes of every workflow file one apply sends. */
  maxWorkflowBytes: 8_000_000,
  /**
   * UTF-8 bytes of every workflow file one get writes; a workflow past it is skipped. Larger than
   * `maxWorkflowBytes`, since an apply sends only the workflows it edits.
   */
  maxDirectoryWorkflowBytes: 32_000_000,
  /** Bytes of one blob (a knowledge document or a workspace file). */
  maxBlobBytes: 10_000_000,
  /** Blob bytes one staging request carries (and one request may download to hash). */
  maxBlobBytesPerRequest: 24_000_000,
  /** Blobs one staging request carries. */
  maxBlobsPerRequest: 1_000,
  /** Blobs one caller may hold staged in one workspace at once. */
  maxStagedBlobs: 20_000,
  /** Bytes one caller may hold staged in one workspace at once. */
  maxStagedBytes: 4_000_000_000,
  /** Blobs (workspace files and knowledge documents together) one directory lists. */
  maxBlobs: 20_000,
  /** Workflows one apply evaluates. */
  maxWorkflows: 100,
  /** Planned changes one apply makes, no-ops excluded. */
  maxChanges: 1_000,
  /**
   * Rows one table's `tables/<key>.rows.jsonl` holds. Mirrors the most rows one replace writes
   * (`MAX_REPLACE_TABLE_ROWS`, apps/sim/lib/table/application/rows.ts).
   */
  maxTableRows: 10_000,
  /** UTF-8 bytes of every table rows file together, apart from the declaration budget. */
  maxRowsBytes: 16_000_000,
  /** Columns in one table. Mirrors `TABLE_LIMITS.MAX_COLUMNS_PER_TABLE` (apps/sim/lib/table). */
  maxColumns: 1_000,
  /** Nesting depth of a declaration file. */
  maxDepth: 200,
} as const

/**
 * Body cap for a workspace source apply: declarations, table rows and workflow files doubled for
 * JSON string escaping, plus room for the base and the blob manifest (blob bytes are staged
 * beforehand).
 */
export const WORKSPACE_SOURCE_REQUEST_MAX_BYTES =
  2 *
    (WORKSPACE_SOURCE_LIMITS.maxDeclarationBytes +
      WORKSPACE_SOURCE_LIMITS.maxRowsBytes +
      WORKSPACE_SOURCE_LIMITS.maxWorkflowBytes) +
  6_000_000

/** Body cap for one staging request: its blobs plus multipart framing. */
export const WORKSPACE_SOURCE_STAGE_MAX_BYTES =
  WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest + 2_000_000

/**
 * Splits `blobs` into staging requests, in order: each carries at most `maxBlobsPerRequest` blobs
 * and `maxBlobBytesPerRequest` bytes, and always at least one blob, so every request progresses.
 */
export function stageBatches<T extends { size: number }>(blobs: readonly T[]): T[][] {
  const { maxBlobBytesPerRequest, maxBlobsPerRequest } = WORKSPACE_SOURCE_LIMITS
  const batches: T[][] = []
  let batch: T[] = []
  let bytes = 0
  for (const blob of blobs) {
    if (
      batch.length > 0 &&
      (bytes + blob.size > maxBlobBytesPerRequest || batch.length >= maxBlobsPerRequest)
    ) {
      batches.push(batch)
      batch = []
      bytes = 0
    }
    batch.push(blob)
    bytes += blob.size
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}
