import { workflowExecutionLogs } from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'

/**
 * Any span in the stored trace, at any depth, that errored and was recovered
 * by an error path (`errorHandled: true`). A run with one keeps `level: info`
 * because the workflow itself succeeded, which is why the run list cannot
 * surface it through `level` alone.
 */
const HANDLED_ERROR_SPAN_PATH = '$.traceSpans.** ? (@.status == "error" && @.errorHandled == true)'

/**
 * Whether a run's stored execution data holds a handled block error.
 *
 * Reads the inline `execution_data` column only: a trace externalized to the
 * blob store is slimmed to its marker keys in the row, so its spans are not
 * visible to this predicate and such a run answers `false`. Null execution
 * data answers `false` rather than null so the value can be published as a
 * boolean and counted with `FILTER`.
 */
export function handledErrorSpanCondition(): SQL<boolean> {
  return sql<boolean>`COALESCE(jsonb_path_exists(${workflowExecutionLogs.executionData}, ${HANDLED_ERROR_SPAN_PATH}::jsonpath), false)`
}
