#!/usr/bin/env bun

/**
 * One-shot reconciliation: copy any messages present in
 * `copilot_chats.messages` JSONB but missing from `copilot_messages`.
 *
 * Idempotent via `ON CONFLICT (chat_id, message_id) DO NOTHING`. Safe to
 * re-run. Intended to be run manually before cutting reads over to the new
 * table (R+1 of the dual-write rollout), or after a known dual-write outage.
 *
 * Usage:
 *   DATABASE_URL=... bun apps/sim/scripts/copilot-messages-reconcile.ts [--since=<interval>]
 *
 * Examples:
 *   bun apps/sim/scripts/copilot-messages-reconcile.ts
 *   bun apps/sim/scripts/copilot-messages-reconcile.ts --since='7 days'
 *   bun apps/sim/scripts/copilot-messages-reconcile.ts --since='1 hour'
 *
 * Omit --since to reconcile the entire table.
 */

import { sql } from 'drizzle-orm'
import { db } from '../../../packages/db/db.js'

function parseSinceArg(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith('--since='))
  if (!arg) return null
  const value = arg.slice('--since='.length).trim()
  if (!value) {
    throw new Error('--since requires a value, e.g. --since="7 days"')
  }
  if (!/^[\w\s]+$/.test(value)) {
    throw new Error(`--since value must be a simple interval like "7 days"; got: ${value}`)
  }
  return value
}

async function main(): Promise<void> {
  const since = parseSinceArg(process.argv.slice(2))
  const windowClause = since
    ? sql`AND c.updated_at > now() - ${sql.raw(`interval '${since}'`)}`
    : sql``

  console.log(
    since
      ? `Reconciling copilot_messages for chats updated in the last ${since}…`
      : 'Reconciling copilot_messages across the full copilot_chats table…'
  )
  const startedAt = Date.now()

  const result = await db.execute(sql`
    INSERT INTO copilot_messages (chat_id, message_id, role, content, model, created_at, updated_at)
    SELECT
      c.id,
      msg.value->>'id',
      msg.value->>'role',
      msg.value,
      c.model,
      (msg.value->>'timestamp')::timestamptz,
      (msg.value->>'timestamp')::timestamptz
    FROM copilot_chats c
    CROSS JOIN LATERAL jsonb_array_elements(c.messages) AS msg(value)
    WHERE jsonb_typeof(c.messages) = 'array'
      AND jsonb_array_length(c.messages) > 0
      ${windowClause}
    ON CONFLICT (chat_id, message_id) DO NOTHING
  `)

  const elapsedMs = Date.now() - startedAt
  const rowCount = (result as { rowCount?: number }).rowCount ?? 0
  console.log(`Inserted ${rowCount} new rows in ${(elapsedMs / 1000).toFixed(1)}s.`)
}

main()
  .catch((err) => {
    console.error('Reconciliation failed:', err)
    process.exit(1)
  })
  .finally(() => {
    process.exit(0)
  })
