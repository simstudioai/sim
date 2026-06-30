/**
 * Versioned CSV snapshot cache for table mounts.
 *
 * Materializes a table's CSV into object storage once per `rows_version` and reuses it across
 * executions until the table mutates (the `bump_user_table_rows_version` trigger invalidates the
 * key). This replaces draining the whole table into web-process heap on every mount.
 *
 * Tenant isolation: callers must pass a table they have already authorized (the
 * `function-execute` mount path enforces `table.workspaceId === context.workspaceId`); the key is
 * namespaced by `workspaceId` and the row reads are workspace-filtered, so a snapshot can only ever
 * contain — and be addressed by — its owning tenant.
 */

import { createHash } from 'crypto'
import { db } from '@sim/db'
import { userTableDefinitions } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { getColumnId } from '@/lib/table/column-keys'
import { formatCsvValue, neutralizeCsvFormula, toCsvRow } from '@/lib/table/export-format'
import { selectExportRowPage } from '@/lib/table/jobs/service'
import type { TableDefinition } from '@/lib/table/types'
import { createMultipartUpload, deleteFile, headObject } from '@/lib/uploads/core/storage-service'

const logger = createLogger('TableSnapshotCache')

const SNAPSHOT_STORAGE_CONTEXT = 'execution' as const
const SNAPSHOT_CONTENT_TYPE = 'text/csv; charset=utf-8'
const SNAPSHOT_BATCH_SIZE = 5000

/**
 * Upper bound on a materialized snapshot. The sandbox now fetches snapshots by presigned URL (bytes
 * never pass through web heap), so this is no longer a RAM limit — it bounds the worst-case inline
 * materialization on a cache miss (a synchronous full-table scan in the copilot request). 500MB
 * covers most large tables at ~tens of seconds; truly unbounded sizes want a background materializer.
 */
export const SNAPSHOT_MAX_BYTES = 500 * 1024 * 1024

export interface TableSnapshotRef {
  key: string
  size: number
  version: number
}

/** Thrown when a table's CSV would exceed {@link SNAPSHOT_MAX_BYTES}; surfaced as a mount error. */
export class TableSnapshotTooLargeError extends Error {
  constructor(tableId: string) {
    super(
      `Table ${tableId} is too large to mount (CSV exceeds ${SNAPSHOT_MAX_BYTES / 1024 / 1024}MB). Filter or split it before mounting.`
    )
    this.name = 'TableSnapshotTooLargeError'
  }
}

/**
 * Fingerprint of the table's column shape (id + display name + order). `rows_version` only advances
 * on row mutations (the trigger fires on `user_table_rows`), so without this a schema edit — rename,
 * add, remove, or reorder a column — would change the CSV header/columns but keep the same key and
 * serve a stale snapshot. Folding it into the key invalidates the cache on any schema change. This
 * is also the seam for a future column-subset / filtered projection (mix it into the same hash).
 */
function schemaFingerprint(table: TableDefinition): string {
  const shape = table.schema.columns.map((c) => [getColumnId(c), c.name])
  return createHash('sha1').update(JSON.stringify(shape)).digest('hex').slice(0, 12)
}

/** Storage key for a table's snapshot at a given row version + column shape. */
function snapshotKey(
  workspaceId: string,
  tableId: string,
  version: number,
  shapeHash: string
): string {
  return `table-snapshots/${workspaceId}/${tableId}/v${version}-${shapeHash}.csv`
}

async function readRowsVersion(tableId: string): Promise<number> {
  const [row] = await db
    .select({ rowsVersion: userTableDefinitions.rowsVersion })
    .from(userTableDefinitions)
    .where(eq(userTableDefinitions.id, tableId))
    .limit(1)
  if (!row) throw new Error(`Table ${tableId} not found while reading rows_version`)
  return row.rowsVersion
}

/**
 * Streams the table CSV (keyset-paginated, like the export worker) into storage under `key`,
 * aborting if it crosses {@link SNAPSHOT_MAX_BYTES}. Returns the stored byte size. Bytes match the
 * canonical export format (id-keyed reads, display-name headers).
 */
async function materialize(table: TableDefinition, key: string): Promise<number> {
  const columns = table.schema.columns
  const handle = await createMultipartUpload({
    key,
    context: SNAPSHOT_STORAGE_CONTEXT,
    contentType: SNAPSHOT_CONTENT_TYPE,
  })

  try {
    let bytes = 0
    const header = `${toCsvRow(columns.map((c) => neutralizeCsvFormula(c.name)))}\n`
    bytes += Buffer.byteLength(header)
    await handle.write(header)

    let after: { orderKey: string; id: string } | null = null
    while (true) {
      const page = await selectExportRowPage(table, after, SNAPSHOT_BATCH_SIZE)
      if (page.length === 0) break

      const chunk = page
        .map((row) => `${toCsvRow(columns.map((c) => formatCsvValue(row.data[getColumnId(c)])))}\n`)
        .join('')
      bytes += Buffer.byteLength(chunk)
      if (bytes > SNAPSHOT_MAX_BYTES) throw new TableSnapshotTooLargeError(table.id)
      await handle.write(chunk)

      const last = page[page.length - 1]
      after = { orderKey: last.orderKey, id: last.id }
      if (page.length < SNAPSHOT_BATCH_SIZE) break
    }

    const { size } = await handle.complete()
    return size
  } catch (err) {
    await handle.abort().catch(() => {})
    throw err
  }
}

/** Best-effort removal of the immediately-prior version (the common single-mutation case). */
async function deletePreviousVersion(
  table: TableDefinition,
  version: number,
  shapeHash: string
): Promise<void> {
  if (version <= 0) return
  await deleteFile({
    key: snapshotKey(table.workspaceId, table.id, version - 1, shapeHash),
    context: SNAPSHOT_STORAGE_CONTEXT,
  }).catch(() => {})
}

/**
 * Returns the storage key + size of the table's snapshot at its current `rows_version`,
 * materializing and storing it on a miss. The caller mounts by reference (head/download the key).
 *
 * Best-effort consistency: the version is read, the CSV materialized, then the version re-read. A
 * mutation mid-scan (rare) re-keys to the new version and rebuilds once — no DB transaction is held
 * across the upload. Concurrent misses write the same version-pinned key (idempotent).
 */
export async function getOrCreateTableSnapshot(
  table: TableDefinition,
  requestId: string
): Promise<TableSnapshotRef> {
  const shapeHash = schemaFingerprint(table)
  const version = await readRowsVersion(table.id)
  const key = snapshotKey(table.workspaceId, table.id, version, shapeHash)

  const head = await headObject(key, SNAPSHOT_STORAGE_CONTEXT)
  if (head) {
    logger.info(`[${requestId}] Snapshot hit`, { tableId: table.id, version, size: head.size })
    return { key, size: head.size, version }
  }

  logger.info(`[${requestId}] Snapshot miss; materializing`, { tableId: table.id, version })
  const size = await materialize(table, key)

  const after = await readRowsVersion(table.id)
  if (after !== version) {
    // The table mutated mid-scan: the bytes under `key` may be torn. Re-key to the new version and
    // rebuild once (or reuse if a concurrent writer already stored it); drop the stale object.
    logger.info(`[${requestId}] rows_version advanced during materialize; re-keying`, {
      tableId: table.id,
      from: version,
      to: after,
    })
    const newKey = snapshotKey(table.workspaceId, table.id, after, shapeHash)
    const newHead = await headObject(newKey, SNAPSHOT_STORAGE_CONTEXT)
    const newSize = newHead ? newHead.size : await materialize(table, newKey)
    await deleteFile({ key, context: SNAPSHOT_STORAGE_CONTEXT }).catch(() => {})
    void deletePreviousVersion(table, after, shapeHash)
    return { key: newKey, size: newSize, version: after }
  }

  void deletePreviousVersion(table, version, shapeHash)
  return { key, size, version }
}
