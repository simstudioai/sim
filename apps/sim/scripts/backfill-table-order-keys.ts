#!/usr/bin/env bun

/**
 * Backfills the `order_key` column on `user_table_rows`.
 *
 * Row ordering is moving from the contiguous integer `position` to a fractional
 * string `order_key` (O(1) insert/delete — no reshift/recompact). This script
 * assigns each existing row a key derived from its current `position` order, so
 * the new ordering matches today's once the `TABLES_FRACTIONAL_ORDERING` flag is
 * flipped on.
 *
 * Per-table-atomic: each table is keyed inside one transaction holding the same
 * per-table advisory lock the app uses for inserts, so a concurrent insert can't
 * interleave. Idempotent: tables already fully keyed are skipped; a table with
 * any NULL key is fully re-keyed from `position` order (deterministic, so a
 * re-run after a partial failure is safe).
 *
 * Usage:
 *   DATABASE_URL=... bun run apps/sim/scripts/backfill-table-order-keys.ts
 *   DATABASE_URL=... bun run apps/sim/scripts/backfill-table-order-keys.ts --dry-run
 */

import { userTableRows } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { asc, eq, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { nKeysBetween } from '@/lib/table/order-key'

/**
 * Rows written per `UPDATE … FROM (VALUES …)`. One statement for a whole large table builds an
 * enormous VALUES list that overflows the JS call stack while drizzle assembles it (and would
 * exceed Postgres's 65535-bound-param limit at ~32k rows, 2 params/row). 5000 keeps ~10k params
 * — well under both ceilings — while minimizing round-trips. Chunks share the one per-table
 * transaction, so the table is still keyed atomically.
 */
const WRITE_CHUNK_SIZE = 5000

export async function runBackfill(): Promise<void> {
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
    // Tables that still have at least one un-keyed row.
    const pending = await db
      .selectDistinct({ tableId: userTableRows.tableId })
      .from(userTableRows)
      .where(isNull(userTableRows.orderKey))

    console.log(
      `Backfill starting — ${pending.length} table(s) with NULL order_key${dryRun ? ' [DRY RUN]' : ''}`
    )

    for (const { tableId } of pending) {
      stats.tables += 1
      try {
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
          if (dryRun) return rows.length

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
        console.log(`  ${tableId}: keyed ${keyed} rows`)
      } catch (error) {
        stats.failed += 1
        console.error(`  ${tableId}: FAILED — ${getErrorMessage(error)}`)
      }
    }

    console.log('Backfill complete.')
    console.log(`  tables scanned: ${stats.tables}`)
    console.log(`  tables keyed:   ${stats.tablesKeyed}`)
    console.log(`  rows keyed:     ${stats.rowsKeyed}`)
    console.log(`  failed:         ${stats.failed}`)
    if (stats.failed > 0) process.exitCode = 1
  } finally {
    await client.end({ timeout: 5 }).catch(() => {})
  }
}

if ((import.meta as { main?: boolean }).main) {
  try {
    await runBackfill()
  } catch (error) {
    console.error('Backfill aborted:', getErrorMessage(error))
    process.exitCode = 1
  }
}
