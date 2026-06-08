#!/usr/bin/env bun

/**
 * One-off repair for DUPLICATE `user_table_rows.order_key` values.
 *
 * Fractional `order_key`s must be unique within a table: they're the authoritative
 * row order under `TABLES_FRACTIONAL_ORDERING`, and `generateKeyBetween` throws
 * `a >= b` if a neighbor lookup ever returns a key equal to the anchor. Some tables
 * accumulated duplicate keys — e.g. a batch insert that minted the same key for many
 * rows, or keys written before the collation fix in migration 0228. This script
 * finds every table with duplicate keys and re-keys it, minting a fresh DISTINCT run
 * with `nKeysBetween` while preserving the current display order.
 *
 * Ordering matters. Rows are re-keyed in `(order_key, id)` order — exactly how the
 * app sorts them under the flag (`order_key` authoritative, `id` as the tiebreak
 * duplicates currently fall back to). We deliberately do NOT re-key by `position`:
 * with the fractional flag on, `position` is only an append counter (a row inserted
 * in the middle gets a mid-range key but the largest `position`), so re-keying by
 * `position` would scramble the real order. Run AFTER migration 0228 so `order_key`
 * sorts bytewise (`COLLATE "C"`), matching the library and the app.
 *
 * Distinct from `backfill-table-order-keys.ts`, which keys rows with NULL keys. This
 * one only touches tables that have actual duplicates — a table whose keys merely
 * disagree with `position` (normal for flag-on middle-inserts) is left alone.
 *
 * Per-table-atomic: each table is re-keyed inside one transaction holding the same
 * per-table advisory lock the app uses for inserts, so a concurrent insert can't
 * interleave. Idempotent: a table with no duplicate keys is never selected, so a
 * re-run after a partial failure is safe. `--dry-run` sizes without locking or
 * writing.
 *
 * Usage:
 *   DATABASE_URL=... bun run apps/sim/scripts/repair-table-order-key-collation.ts
 *   DATABASE_URL=... bun run apps/sim/scripts/repair-table-order-key-collation.ts --dry-run
 */

import { userTableRows } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { nKeysBetween } from '@/lib/table/order-key'

/** See backfill-table-order-keys.ts — keeps each VALUES list well under the param/stack ceilings. */
const WRITE_CHUNK_SIZE = 5000

export async function runRepair(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!connectionString) {
    console.error('Missing DATABASE_URL or POSTGRES_URL')
    process.exit(1)
  }

  const client = postgres(connectionString, {
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 30,
    max: 5,
    onnotice: () => {},
  })
  const db = drizzle(client)

  const stats = { tables: 0, tablesKeyed: 0, rowsKeyed: 0, failed: 0 }

  try {
    // Tables that have at least one duplicate `order_key`. This is the only genuine
    // corruption: distinct keys that merely disagree with `position` are normal
    // under the flag and must NOT be touched.
    const pending = await db.execute<{ table_id: string }>(sql`
      SELECT DISTINCT table_id FROM (
        SELECT table_id
        FROM user_table_rows
        WHERE order_key IS NOT NULL
        GROUP BY table_id, order_key
        HAVING count(*) > 1
      ) d
    `)

    console.log(
      `Repair starting — ${pending.length} table(s) with duplicate keys${dryRun ? ' [DRY RUN]' : ''}`
    )

    for (const { table_id: tableId } of pending) {
      stats.tables += 1
      try {
        if (dryRun) {
          // Sizing only — count outside any transaction/lock so we never serialize
          // live inserts on the table.
          const [row] = await db
            .select({ rowCount: sql<number>`count(*)`.mapWith(Number) })
            .from(userTableRows)
            .where(eq(userTableRows.tableId, tableId))
          stats.tablesKeyed += 1
          stats.rowsKeyed += row.rowCount
          console.log(`  ${tableId}: would re-key ${row.rowCount} rows`)
          continue
        }

        const keyed = await db.transaction(async (trx) => {
          // Serialize with concurrent inserts on this table (same lock the app uses).
          await trx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`user_table_rows_pos:${tableId}`}, 0))`
          )
          // Read in the app's display order — `order_key` (bytewise via COLLATE "C"
          // after migration 0228), `id` as the duplicate tiebreak — so the fresh run
          // preserves exactly what users currently see, minus the duplication.
          const rows = await trx
            .select({ id: userTableRows.id })
            .from(userTableRows)
            .where(eq(userTableRows.tableId, tableId))
            .orderBy(asc(userTableRows.orderKey), asc(userTableRows.id))

          if (rows.length === 0) return 0
          const keys = nKeysBetween(null, null, rows.length)

          // Chunked UPDATE … FROM (VALUES …) mapping id → key (see WRITE_CHUNK_SIZE).
          for (let start = 0; start < rows.length; start += WRITE_CHUNK_SIZE) {
            const chunk = rows.slice(start, start + WRITE_CHUNK_SIZE)
            const values = sql.join(
              chunk.map((r, i) => sql`(${r.id}, ${keys[start + i]})`),
              sql`, `
            )
            await trx.execute(sql`
              UPDATE user_table_rows AS t
              SET order_key = v.order_key
              FROM (VALUES ${values}) AS v(id, order_key)
              WHERE t.id = v.id AND t.table_id = ${tableId}
            `)
          }
          return rows.length
        })
        stats.tablesKeyed += 1
        stats.rowsKeyed += keyed
        console.log(`  ${tableId}: re-keyed ${keyed} rows`)
      } catch (error) {
        stats.failed += 1
        console.error(`  ${tableId}: FAILED — ${getErrorMessage(error)}`)
      }
    }

    const verb = dryRun ? 'to re-key' : 're-keyed'
    console.log(`Repair complete.${dryRun ? ' [DRY RUN — no rows written]' : ''}`)
    console.log(`  tables scanned: ${stats.tables}`)
    console.log(`  tables ${verb}: ${stats.tablesKeyed}`)
    console.log(`  rows ${verb}: ${stats.rowsKeyed}`)
    console.log(`  failed: ${stats.failed}`)
    if (stats.failed > 0) process.exitCode = 1
  } finally {
    await client.end({ timeout: 5 }).catch(() => {})
  }
}

if ((import.meta as { main?: boolean }).main) {
  try {
    await runRepair()
  } catch (error) {
    console.error('Repair aborted:', getErrorMessage(error))
    process.exitCode = 1
  }
}
