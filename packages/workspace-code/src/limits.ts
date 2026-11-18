/**
 * The limits workspace source shares across reading and writing. A get skips what an apply would
 * refuse (a blob over `maxBlobBytes`, or a resource that would take the directory past
 * `maxDeclarationBytes` or `maxBlobs`, is listed in `.sim/skipped.json`), so anything a get writes
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
  /** Bytes of one blob (a knowledge document or a workspace file). */
  maxBlobBytes: 10_000_000,
  /** Blob bytes one request carries; an apply over it continues in further rounds. */
  maxBlobBytesPerRequest: 24_000_000,
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
 * JSON string escaping, blob content as base64 (4 bytes per 3), plus room for the base.
 */
export const WORKSPACE_SOURCE_REQUEST_MAX_BYTES =
  2 *
    (WORKSPACE_SOURCE_LIMITS.maxDeclarationBytes +
      WORKSPACE_SOURCE_LIMITS.maxRowsBytes +
      WORKSPACE_SOURCE_LIMITS.maxWorkflowBytes) +
  Math.ceil((WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest * 4) / 3) +
  2_000_000

/**
 * The blob paths one apply round carries content for: those `wanted` names, in manifest order,
 * while they fit `maxBlobBytesPerRequest` (always at least one, so every round makes progress).
 */
export function roundPaths(
  manifest: ReadonlyArray<{ path: string; size: number }>,
  wanted: ReadonlySet<string>
): Set<string> {
  let bytes = 0
  const carried = new Set<string>()
  for (const blob of manifest) {
    if (!wanted.has(blob.path)) continue
    if (bytes > 0 && bytes + blob.size > WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest) continue
    bytes += blob.size
    carried.add(blob.path)
  }
  return carried
}
