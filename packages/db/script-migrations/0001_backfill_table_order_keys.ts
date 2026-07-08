import { getErrorMessage } from '@sim/utils/errors'
import { generateNKeysBetween } from '@sim/utils/fractional-indexing'
import type { ScriptMigration } from './types'

/**
 * Rows written per `UPDATE … FROM unnest(...)` statement. The two unnest
 * arrays are single bind parameters, so chunking only bounds per-statement
 * work and wire-message size, not parameter count. Chunks share the one
 * per-table transaction, so the table is still keyed atomically.
 */
const WRITE_CHUNK_SIZE = 5000

/**
 * Backfills the `order_key` column on `user_table_rows`.
 *
 * Row ordering moved from the contiguous integer `position` to a fractional
 * string `order_key` (O(1) insert/delete — no reshift/recompact). Each existing
 * row gets a key derived from its current `position` order, so the fractional
 * ordering matches today's once `TABLES_FRACTIONAL_ORDERING` is on.
 *
 * Per-table-atomic: each table is keyed inside one transaction holding the same
 * per-table advisory lock the app uses for inserts, so a concurrent insert
 * can't interleave. Idempotent: tables already fully keyed are skipped; a table
 * with any NULL key is fully re-keyed from `position` order (deterministic, so
 * a re-run after a partial failure is safe). Per-table failures are isolated —
 * remaining tables still run, then the migration throws so it stays pending and
 * retries (only still-unkeyed tables) on the next upgrade.
 */
export const backfillTableOrderKeys: ScriptMigration = {
  name: '0001_backfill_table_order_keys',
  async up(sql) {
    const pending = await sql<{ table_id: string }[]>`
      SELECT DISTINCT table_id FROM user_table_rows WHERE order_key IS NULL
    `
    console.log(`order_key backfill — ${pending.length} table(s) with NULL order_key`)

    const stats = { tablesKeyed: 0, rowsKeyed: 0, failed: 0 }

    for (const { table_id: tableId } of pending) {
      try {
        const keyed = await sql.begin(async (tx) => {
          await tx`
            SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_rows_pos:${tableId}`}, 0))
          `
          const rows = await tx<{ id: string }[]>`
            SELECT id FROM user_table_rows
            WHERE table_id = ${tableId}
            ORDER BY position ASC, id ASC
          `
          if (rows.length === 0) return 0
          const keys = generateNKeysBetween(null, null, rows.length)

          for (let start = 0; start < rows.length; start += WRITE_CHUNK_SIZE) {
            const chunk = rows.slice(start, start + WRITE_CHUNK_SIZE)
            const ids = chunk.map((r) => r.id)
            const chunkKeys = keys.slice(start, start + chunk.length)
            await tx`
              UPDATE user_table_rows AS t
              SET order_key = v.order_key
              FROM (
                SELECT unnest(${ids}::text[]) AS id, unnest(${chunkKeys}::text[]) AS order_key
              ) AS v
              WHERE t.id = v.id AND t.table_id = ${tableId}
            `
          }
          return rows.length
        })
        stats.tablesKeyed += 1
        stats.rowsKeyed += keyed
        console.log(`  ${tableId}: keyed ${keyed} rows`)
      } catch (error) {
        stats.failed += 1
        console.error(`  ${tableId}: FAILED — ${getErrorMessage(error)}`)
      }
    }

    console.log(
      `order_key backfill done — tables keyed: ${stats.tablesKeyed}, ` +
        `rows keyed: ${stats.rowsKeyed}, failed: ${stats.failed}`
    )
    if (stats.failed > 0) {
      throw new Error(`order_key backfill failed for ${stats.failed} table(s); will retry next run`)
    }
  },
}
