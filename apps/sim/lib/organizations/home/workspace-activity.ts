import { db } from '@sim/db'
import { pausedExecutions, workflow, workflowExecutionLogs, workspace } from '@sim/db/schema'
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { getExecutionReservationTtlMs } from '@/lib/core/execution-limits'

const LIVE_PAUSED_STATUSES = ['paused', 'partially_resumed']

/**
 * A pause point still waiting on a person. A point with no `pauseKind` predates the field and is
 * human, the same default the resume path applies.
 */
const WAITING_ON_A_PERSON = sql.raw(
  `'$.* ? (@.resumeStatus == "paused" && !(@.pauseKind == "time"))'`
)

interface WorkspaceRunningRow {
  workspaceId: string
  workflowName: string | null
}

/**
 * The newest live run per workspace, using the sweeper's own idea of alive without its grace period:
 * a row past its deadline is dead or about to be failed, so it is not reported as running. The status
 * is a literal so the planner can prove the small partial index on running rows applies.
 */
export function readRunningWorkflows(
  workspaceIds: readonly string[],
  now: Date
): Promise<WorkspaceRunningRow[]> {
  const logs = workflowExecutionLogs
  return db
    .selectDistinctOn([logs.workspaceId], {
      workspaceId: logs.workspaceId,
      workflowName: workflow.name,
    })
    .from(logs)
    .leftJoin(workflow, eq(workflow.id, logs.workflowId))
    .where(
      and(
        sql`${logs.status} = 'running'`,
        inArray(logs.workspaceId, [...workspaceIds]),
        or(
          gt(logs.executionDeadlineAt, now),
          and(
            isNull(logs.executionDeadlineAt),
            gt(logs.startedAt, new Date(now.getTime() - getExecutionReservationTtlMs()))
          )
        )
      )
    )
    .orderBy(logs.workspaceId, sql`${logs.startedAt} DESC`)
}

/**
 * Per workspace, one workflow waiting on a person and the newest retained run. Each is a `LIMIT 1`
 * probe, so many unanswered pauses cost what one does once a match exists. The waiting workflow is
 * therefore any of them rather than the newest. With no match, the probe reads every live pause of
 * that workspace.
 *
 * The pauses are a lateral of their own so the planner has to start from the workspace's workflows.
 * It cannot estimate the JSON test, and as a plain join under `LIMIT 1` it expects an early match and
 * scans the whole table for one, reading every organization's pauses once per workspace.
 */
export function readReviewAndLastRun(workspaceIds: readonly string[]) {
  const logs = workflowExecutionLogs
  const waitingPause = db
    .select({ id: pausedExecutions.id })
    .from(pausedExecutions)
    .where(
      and(
        eq(pausedExecutions.workflowId, workflow.id),
        inArray(pausedExecutions.status, LIVE_PAUSED_STATUSES),
        sql`jsonb_path_exists(${pausedExecutions.pausePoints}, ${WAITING_ON_A_PERSON})`
      )
    )
    .limit(1)
    .as('waiting_pause')
  const waiting = db
    .select({ workflowName: workflow.name })
    .from(workflow)
    .innerJoinLateral(waitingPause, sql`true`)
    .where(and(eq(workflow.workspaceId, workspace.id), isNull(workflow.archivedAt)))
    .limit(1)
    .as('waiting')
  const lastRun = db
    .select({
      workflowName: workflow.name,
      status: logs.status,
      startedAt: logs.startedAt,
    })
    .from(logs)
    .leftJoin(workflow, eq(workflow.id, logs.workflowId))
    .where(eq(logs.workspaceId, workspace.id))
    .orderBy(sql`${logs.startedAt} DESC NULLS LAST`, sql`${logs.id} DESC`)
    .limit(1)
    .as('last_run')
  return db
    .select({
      workspaceId: workspace.id,
      waitingWorkflowName: waiting.workflowName,
      lastRunWorkflowName: lastRun.workflowName,
      lastRunStatus: lastRun.status,
      lastRunStartedAt: lastRun.startedAt,
    })
    .from(workspace)
    .leftJoinLateral(waiting, sql`true`)
    .leftJoinLateral(lastRun, sql`true`)
    .where(inArray(workspace.id, [...workspaceIds]))
}
