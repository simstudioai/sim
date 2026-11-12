import { pausedExecutions } from '@sim/db/schema'
import { sql } from 'drizzle-orm'

/**
 * Every pause point of a `paused_executions` row, as the derived table `point(value)`.
 *
 * `pause_points` is an object keyed by context id, or an array on legacy rows; both shapes are
 * read, as `normalizePausePoints` reads them, and each set function only ever receives the shape
 * it accepts.
 */
export const PAUSE_POINT_ROWS = sql`(
  select value from jsonb_each(
    case when jsonb_typeof(${pausedExecutions.pausePoints}) = 'object'
      then ${pausedExecutions.pausePoints} else '{}'::jsonb end
  )
  union all
  select value from jsonb_array_elements(
    case when jsonb_typeof(${pausedExecutions.pausePoints}) = 'array'
      then ${pausedExecutions.pausePoints} else '[]'::jsonb end
  )
) as point(value)`
