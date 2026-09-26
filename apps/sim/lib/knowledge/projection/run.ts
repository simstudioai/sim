import { resolveDbUrl } from '@sim/db'
import {
  type KnowledgeProjectionProgress,
  MARK_RELEASE_BUDGET_MS,
  releaseSettledMarks,
  runKnowledgeProjection,
} from '@sim/db/knowledge-projection'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { createLogger } from '@sim/logger'
import postgres, { type Sql } from 'postgres'
import { env, envNumber } from '@/lib/core/config/env'
import { isIndexedOrgSearchEnabled } from '@/lib/sim-search/indexed/gate'

const logger = createLogger('KnowledgeProjectionPass')

/**
 * Most documents one pass projects at once, each worker on a connection of its own. Measured
 * locally on content-heavy load, projection throughput kept rising to eight workers without
 * deadlocks, so eight is the default; `KB_CONFIG_PROJECTION_CONCURRENCY` raises or lowers it per
 * deployment. A round opens only as many workers as there are marks, so a pass over a few
 * documents holds a few connections.
 */
const PROJECTION_CONCURRENCY = envNumber(env.KB_CONFIG_PROJECTION_CONCURRENCY, 8, {
  min: 1,
  integer: true,
})

/** How the projector's connections name themselves in `pg_stat_activity`. */
const PROJECTOR_APPLICATION_NAME = 'sim-knowledge-projector'

/** Workers the next round needs: one per mark, counted no further than the concurrency. */
async function workersFor(session: Sql): Promise<number> {
  const [{ marks }] = await session<Array<{ marks: number }>>`
    SELECT count(*)::int AS marks
    FROM (SELECT 1 FROM knowledge_projection_dirty LIMIT ${PROJECTION_CONCURRENCY}) AS waiting`
  return Math.max(1, marks)
}

export interface KnowledgeProjectionPassResult extends KnowledgeProjectionProgress {
  /** Marks removed without a pass over their rows, since no pass was owed them. */
  released: number
}

/**
 * One pass of the knowledge projector: settles every marked document. Each round first releases,
 * for no longer than a release's own short budget, the marks no pass is owed (see
 * `releaseSettledMarks`), so a backlog of them shrinks every round without holding up the content
 * behind it. What is left is projected: content a writer deferred, and, while indexed organization
 * search is on, search-index documents, whose rows mirror their source and ACL.
 *
 * Workers project documents in parallel, each on a connection of its own that holds its
 * per-document advisory locks; a pass this long should not hold the pool's connections. Workers
 * read the same oldest marks and split them at those locks. A round ends when every worker found
 * nothing more it could take; the pass goes on while rounds settle documents, and `remaining`
 * reports marks it left for the next sweep.
 *
 * The pass writes Tin keyword rows only while indexed organization search is enabled: only that
 * search reads them.
 */
export async function runKnowledgeProjectionPass(options: {
  budgetMs: number
}): Promise<KnowledgeProjectionPassResult> {
  const url = resolveDbUrl('DATABASE_URL', process.env.SIM_DB_ROLE?.trim() || 'web')
  if (!url) throw new Error('DATABASE_URL is required to run the knowledge projector')
  /** Each connects on its first query, so a worker a round never needs opens no connection. */
  const sessions = Array.from({ length: PROJECTION_CONCURRENCY }, () =>
    postgres(
      url,
      withUtcTimestamps({
        max: 1,
        max_lifetime: null,
        onnotice: () => undefined,
        connection: { application_name: PROJECTOR_APPLICATION_NAME },
      })
    )
  )
  const deadline = Date.now() + options.budgetMs
  const scope = { searchIndexes: isIndexedOrgSearchEnabled() }
  const result: KnowledgeProjectionPassResult = {
    settled: 0,
    deferred: 0,
    pages: 0,
    written: 0,
    remaining: false,
    released: 0,
  }
  try {
    while (Date.now() < deadline) {
      const release = await releaseSettledMarks(
        sessions[0],
        Math.min(deadline, Date.now() + MARK_RELEASE_BUDGET_MS),
        scope
      )
      result.released += release.released
      const workers = sessions.slice(0, await workersFor(sessions[0]))
      /** Every worker finishes its document before a failure ends the pass, so none is cut off. */
      const outcomes = await Promise.allSettled(
        workers.map((session) =>
          runKnowledgeProjection(session, {
            budgetMs: Math.max(0, deadline - Date.now()),
            ...scope,
          })
        )
      )
      const round: KnowledgeProjectionProgress[] = []
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') throw outcome.reason
        round.push(outcome.value)
      }
      const settled = round.reduce((sum, progress) => sum + progress.settled, 0)
      result.settled += settled
      result.pages += round.reduce((sum, progress) => sum + progress.pages, 0)
      result.written += round.reduce((sum, progress) => sum + progress.written, 0)
      result.remaining = round.some((progress) => progress.remaining)
      if (!result.remaining) break
      if (settled > 0) continue
      result.deferred = round.reduce((most, progress) => Math.max(most, progress.deferred), 0)
      break
    }
    logger.info('Knowledge projection pass finished', result)
    return result
  } finally {
    await Promise.all(sessions.map((session) => session.end()))
  }
}
