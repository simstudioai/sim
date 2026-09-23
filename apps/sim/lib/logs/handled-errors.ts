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
 * Uses the inline marker retained during trace externalization and compaction,
 * falling back to trace inspection for older inline rows. This keeps filtering
 * and pagination in SQL without loading archived trace payloads. Older archives
 * without a marker cannot be classified here. Null data answers `false`.
 */
export function handledErrorSpanCondition(): SQL<boolean> {
  return sql<boolean>`COALESCE(${workflowExecutionLogs.executionData}->'hasHandledErrors' = 'true'::jsonb, jsonb_path_exists(${workflowExecutionLogs.executionData}, ${HANDLED_ERROR_SPAN_PATH}::jsonpath), false)`
}
