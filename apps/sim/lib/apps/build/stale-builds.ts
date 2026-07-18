import { db } from '@sim/db'
import { appBuild } from '@sim/db/schema'
import { and, eq, lt } from 'drizzle-orm'

/** Must exceed local Vite build timeout (5m) so live builds aren't marked stale. */
export const STALE_RUNNING_BUILD_MS = 6 * 60 * 1000

/**
 * Mark hung `running` builds as failed so concurrency checks cannot brick a project.
 * Returns number of rows finalized.
 */
export async function finalizeStaleRunningBuilds(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_RUNNING_BUILD_MS)
  const updated = await db
    .update(appBuild)
    .set({
      status: 'failed',
      finishedAt: now,
      diagnostics: {
        error: 'Build marked stale (worker timeout or crash)',
        stale: true,
      },
    })
    .where(and(eq(appBuild.status, 'running'), lt(appBuild.createdAt, cutoff)))
    .returning({ id: appBuild.id })

  return updated.length
}
