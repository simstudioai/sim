#!/usr/bin/env bun

/**
 * Reads the search ranking projections back into the database's cache. Run it after anything that
 * streams through them outside the backfill — a restore, a failover, an index rebuild — or when
 * searches have started ending at their deadline with partial results after such an event. Needs
 * the `pg_prewarm` extension, which a superuser installs once; without it the script says so and
 * does nothing.
 *
 * Usage:
 *   bun apps/sim/scripts/prewarm-search-projection.ts
 */

import { resolveDbUrl } from '@sim/db'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import postgres from 'postgres'
import { prewarmSearchProjection } from '@/lib/knowledge/search/prewarm'

const logger = createLogger('PrewarmSearchProjection')

async function main(): Promise<void> {
  const url = resolveDbUrl('DATABASE_URL', process.env.SIM_DB_ROLE?.trim() || 'web')
  if (!url) throw new Error('DATABASE_URL is required to warm the search projection')
  const sql = postgres(url, { max: 1, max_lifetime: null, onnotice: () => undefined })
  try {
    const warmed = await prewarmSearchProjection(sql)
    for (const item of warmed) logger.info('Warmed', item)
  } finally {
    await sql.end()
  }
}

if (import.meta.main) {
  main().then(
    () => process.exit(0),
    (error) => {
      logger.error('Prewarm failed', toError(error))
      process.exit(1)
    }
  )
}
