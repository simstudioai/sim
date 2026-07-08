#!/usr/bin/env bun

/**
 * One-off repair for `user_table_rows.order_key` rows mis-ordered by the
 * collation bug fixed in migration 0228.
 *
 * Fractional `order_key`s are base-62 strings the fractional-indexing library
 * compares BYTEWISE (ASCII: `0-9 < A-Z < a-z`). Before migration 0228 the column
 * compared under the database's `en_US.UTF-8` locale, where lowercase interleaves
 * with/precedes uppercase ("a0" < "Zz", the opposite of bytewise). Keys minted in
 * that window were anchored to the wrong neighbors, so a table's keys can be
 * out of order — or duplicated — under bytewise comparison. That makes inserts
 * throw `generateKeyBetween`'s `a >= b` assertion and rows display out of order.
 *
 * This script finds every table whose `order_key`s are mis-assigned: walking rows
 * in their authoritative `position, id` order, a row's key is `>=` the next row's
 * under bytewise (`COLLATE "C"`) comparison. That covers swapped keys (a low
 * position holding a bytewise-larger key than a higher one) and duplicates. Each
 * flagged table is re-keyed from `position` order — the legacy authoritative order
 * the original backfill also used — minting a fresh, evenly-spaced, distinct run
 * with `nKeysBetween`.
 *
 * Distinct from the `0001_backfill_table_order_keys` script migration
 * (`packages/db/script-migrations/`), which keys tables with NULL keys;
 * this one repairs tables that are fully keyed but bytewise-disordered. Run it
 * AFTER migration 0228 so the re-key writes and sorts under `COLLATE "C"`.
 *
 * Per-table-atomic: each table is re-keyed inside one transaction holding the
 * same per-table advisory lock the app uses for inserts, so a concurrent insert
 * can't interleave. Idempotent: a table whose keys are already distinct and
 * ordered is never selected, so a re-run after a partial failure is safe.
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

/** Keeps each VALUES list well under Postgres's 65535-bound-param and JS call-stack ceilings. */
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
    // Tables with a bytewise (`COLLATE "C"`) inversion or duplicate among their
    // non-null keys. Walking rows in their authoritative `position, id` order (the
    // order the re-key writes), a healthy table has strictly INCREASING keys; flag
    // any table where a row's key is `>=` the next row's. Ordering by `position`
    // (not by `order_key`) is what makes this detect actual mis-assignment — e.g.
    // pos 0 holding "a0" while pos 1 holds "Zz" (bytewise "Zz" < "a0") — and not
    // just adjacent duplicates. The explicit `COLLATE "C"` keeps the comparison
    // bytewise whether or not migration 0228 has been applied yet.
    const pending = await db.execute<{ table_id: string }>(sql`
      SELECT DISTINCT table_id FROM (
        SELECT
          table_id,
          order_key,
          LEAD(order_key) OVER (
            PARTITION BY table_id ORDER BY position, id
          ) AS next_key
        FROM user_table_rows
        WHERE order_key IS NOT NULL
      ) t
      WHERE next_key IS NOT NULL AND order_key COLLATE "C" >= next_key COLLATE "C"
    `)

    console.log(
      `Repair starting — ${pending.length} table(s) with mis-ordered keys${dryRun ? ' [DRY RUN]' : ''}`
    )

    for (const { table_id: tableId } of pending) {
      stats.tables += 1
      try {
        if (dryRun) {
          // Sizing only — count outside any transaction/lock so we never serialize
          // live inserts on the table (taking the advisory lock just to count would
          // make the dry run the opposite of safe).
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
          const rows = await trx
            .select({ id: userTableRows.id })
            .from(userTableRows)
            .where(eq(userTableRows.tableId, tableId))
            .orderBy(asc(userTableRows.position), asc(userTableRows.id))

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
