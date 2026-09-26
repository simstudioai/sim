import { SOURCE_ACL_PROJECTIONS, type SourceAclProjection } from '@sim/db/knowledge-projection'
import { embeddingKeywordTin, embeddingSearch } from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { sql } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { runSearchQuery, type SearchBudget } from '@/lib/knowledge/search/budget'
import type { SearchStage } from '@/lib/knowledge/search/diagnostics'

/** How long a fully filled projection is taken on trust before its unfilled rows are looked for again. */
const PROJECTION_FILLED_TTL_MS = 60_000

/**
 * The most of a leg's budget the probe may spend. The probe is one index read that answers in
 * milliseconds when the partial index serves it; a read slower than this is fighting a cold cache
 * or a busy database, and waiting longer would spend the leg's ranking time on an optimization.
 * An unanswered probe costs only the slower plan, so a small cap loses nothing.
 */
export const PROJECTION_FILLED_PROBE_BUDGET_MS = 250

/**
 * How long an unanswered probe is remembered as unfilled. Short enough that a recovered database
 * is asked again within seconds, long enough that searches arriving during an outage do not each
 * spend their own probe budget rediscovering it.
 */
const PROJECTION_FILLED_UNKNOWN_TTL_MS = 5_000

/**
 * Whether the ranking projection still holds rows the source and ACL fill has not reached. Read off the
 * unfilled-rows index in milliseconds and remembered briefly: the answer only ever changes once.
 *
 * The read asks for the last unfilled row by id, not whether one exists: an `EXISTS` drops its
 * order and limit, and while most rows are unfilled the planner expects a sequential scan to
 * meet one at once, then walks the whole projection when the unfilled rows sit past the filled
 * ones. Ordered by id and capped at one row, the read can only be the partial index, whose
 * last entry is the row the fill reaches last.
 */
const projectionFilled = new LRUCache<
  SourceAclProjection,
  boolean,
  { budget: SearchBudget | undefined; stage: SearchStage }
>({
  max: SOURCE_ACL_PROJECTIONS.length,
  ttl: PROJECTION_FILLED_TTL_MS,
  /**
   * The read that misses the cache is the search's own, capped to a small share of its budget,
   * and the searches that miss together share it. A read that fails or runs out of that share
   * answers unfilled, the slower and safe form, and that answer is remembered briefly so the
   * searches behind it do not each pay for the same failure. A read cut short by its own
   * search's cancellation learned nothing about the projection and is not remembered.
   */
  fetchMethod: async (projection, _stale, { context, options }) => {
    const table = projection === 'embedding_search' ? embeddingSearch : embeddingKeywordTin
    try {
      const [row] = await runSearchQuery(
        context.budget?.capped(PROJECTION_FILLED_PROBE_BUDGET_MS),
        context.stage,
        (executor) =>
          executor.execute<{ unfilled: boolean }>(sql`
          SELECT (
            SELECT ${table.id} FROM ${table} WHERE ${table.acl} IS NULL
            ORDER BY ${table.id} DESC LIMIT 1
          ) IS NOT NULL AS unfilled`)
      )
      return !row?.unfilled
    } catch {
      if (context.budget?.signal?.aborted) return undefined
      options.ttl = PROJECTION_FILLED_UNKNOWN_TTL_MS
      return false
    }
  },
})

/**
 * Whether every row of the projection carries its mirrored source and ACL; unknown counts as not yet.
 *
 * Searches that miss the cache together share the first one's read, which is capped to that
 * search's share. Each caller still waits no longer than its own share, or its own deadline if
 * nearer, and reads an unanswered probe as unfilled: a caller that joined late, with less of its
 * leg left, never waits on another search's timetable. A remembered answer is returned at once,
 * so only a search that missed the memo starts a wait.
 */
export async function isProjectionFilled(
  projection: SourceAclProjection,
  stage: SearchStage,
  budget: SearchBudget | undefined
): Promise<boolean> {
  const remembered = projectionFilled.get(projection)
  if (remembered !== undefined) return remembered
  const answer = projectionFilled.fetch(projection, { context: { budget, stage } })
  if (!budget) return (await answer) ?? false
  const waitMs = Math.max(
    0,
    Math.min(PROJECTION_FILLED_PROBE_BUDGET_MS, budget.deadline - performance.now())
  )
  const unanswered = sleep(waitMs).then(() => undefined)
  return (await Promise.race([answer.catch(() => undefined), unanswered])) ?? false
}

/** Forgets whether the projections were filled; the memo is per process and otherwise expires on its own. */
export function forgetProjectionFilled(): void {
  projectionFilled.clear()
}
