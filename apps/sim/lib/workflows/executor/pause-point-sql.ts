import { pausedExecutions } from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'

/**
 * Whether any pause point of a `paused_executions` row matches the jsonpath `filter`, which
 * reads the point as `@`.
 *
 * `pause_points` is an object keyed by context id, or an array on legacy rows; both shapes are
 * read, as `normalizePausePoints` reads them. A `jsonb_path_exists` call per row keeps this cheap
 * enough to evaluate in a `WHERE` across every run of a workflow, which a correlated
 * set-returning subquery is not.
 */
export function somePausePointMatches(filter: string): SQL {
  return sql`(case jsonb_typeof(${pausedExecutions.pausePoints})
    when 'object' then jsonb_path_exists(${pausedExecutions.pausePoints}, ${`$.* ? (${filter})`}::jsonpath)
    when 'array' then jsonb_path_exists(${pausedExecutions.pausePoints}, ${`$[*] ? (${filter})`}::jsonpath)
    else false
  end)`
}
