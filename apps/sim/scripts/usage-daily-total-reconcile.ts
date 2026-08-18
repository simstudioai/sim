#!/usr/bin/env bun

/**
 * One-shot reconciliation: recompute `usage_log_daily_total` from `usage_log`,
 * which stays the source of truth.
 *
 * The rollup is maintained transactionally by both `usage_log` mutation paths,
 * so it should not drift. This exists for the two cases where it can:
 *
 * - Periods that predate the rollup, which have no buckets at all. The
 *   migration deliberately ships an empty table rather than backfilling,
 *   because a migration-time backfill races the deploy: between the migration
 *   running and the new image being live, the old code writes ledger rows
 *   without maintaining the rollup, leaving a stale base every later increment
 *   would build on. Run this once the new image is fully rolled out.
 * - A user deletion, which cascades ledger rows away without lowering the
 *   buckets they fed.
 *
 * Idempotent: writes absolute totals and deletes buckets whose ledger rows are
 * gone, so it is safe to re-run.
 *
 * Run this and confirm it reports no drift BEFORE enabling the
 * `usage-daily-total-reads` flag.
 *
 * Usage:
 *   DATABASE_URL=... bun apps/sim/scripts/usage-daily-total-reconcile.ts [--since=<ISO date>]
 *
 * Examples:
 *   bun apps/sim/scripts/usage-daily-total-reconcile.ts
 *   bun apps/sim/scripts/usage-daily-total-reconcile.ts --since=2026-07-01
 *
 * Omit --since to reconcile every period.
 */

import { reconcileUsageDailyTotals } from '@/lib/billing/core/usage-daily-total'

function parseSinceArg(argv: string[]): Date | undefined {
  const arg = argv.find((a) => a.startsWith('--since='))
  if (!arg) return undefined
  const value = arg.slice('--since='.length).trim()
  const parsed = new Date(value)
  if (!value || Number.isNaN(parsed.getTime())) {
    throw new Error(`--since requires an ISO date, e.g. --since=2026-07-01; got: ${value}`)
  }
  return parsed
}

async function main(): Promise<void> {
  const periodEndsAfter = parseSinceArg(process.argv.slice(2))

  console.log(
    periodEndsAfter
      ? `Reconciling usage_log_daily_total for periods ending after ${periodEndsAfter.toISOString()}…`
      : 'Reconciling usage_log_daily_total across every period…'
  )
  const startedAt = Date.now()

  const { bucketsWritten, bucketsDeleted } = await reconcileUsageDailyTotals({ periodEndsAfter })

  const elapsedMs = Date.now() - startedAt
  console.log(
    `Wrote ${bucketsWritten} buckets and deleted ${bucketsDeleted} orphaned buckets ` +
      `in ${(elapsedMs / 1000).toFixed(1)}s.`
  )
}

main()
  .catch((err) => {
    console.error('Reconciliation failed:', err)
    process.exit(1)
  })
  .finally(() => {
    process.exit(0)
  })
