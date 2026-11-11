import { createLogger } from '@sim/logger'
import { V2_MAX_PAUSED_RUN_POINTS_PER_PAGE } from '@/lib/api/contracts/v2/workflows'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { logProjectionSubjectUserId, resolveLogFieldProjection } from '@/lib/logs/projection'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { isWaitingHumanPausePoint } from '@/lib/workflows/executor/execution-state'
import {
  type PausedRunPoint,
  projectPausedRunPoints,
  readPausedRunPoints,
} from '@/lib/workflows/executor/execution-status'
import { listWorkspacePausedRuns, pausedRunCursorKeys } from '@/lib/workflows/executor/paused-runs'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

const logger = createLogger('ListPausedRuns')

/** Runs whose points are read together; each read is two short queries. */
const POINT_READ_CONCURRENCY = 5

interface ListPausedRunsInput {
  workspaceId: string
  includeOutput: boolean
  sortOrder: ListSortOrder
  cursorKeys?: CursorKey[]
  limit: number
}

interface PausedRun {
  runId: string
  workflowId: string
  workflowName: string
  pausedAt: Date
  points: PausedRunPoint[]
}

/**
 * Lists a workspace's runs waiting on a human, each with the human pause points
 * it still waits at.
 *
 * Each point is read and projected as Get workflow run reads and projects it,
 * so the list never shows a viewer more of a point than the run detail would. A
 * run lists only the human points it still waits at, selected before the
 * per-run cap so they match the predicate the run was listed by. A page ends early, with a cursor, rather than carry more than
 * {@link V2_MAX_PAUSED_RUN_POINTS_PER_PAGE} points; its first run is always
 * included, and a run's own points are already capped.
 */
export const listPausedRuns = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.listPausedRuns,
  resolveContext: ({ input }: { input: ListPausedRunsInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const [page, projection] = await Promise.all([
      listWorkspacePausedRuns({
        workspaceId: context.workspaceId,
        sortOrder: input.sortOrder,
        cursorKeys: input.cursorKeys,
        limit: input.limit,
      }),
      resolveLogFieldProjection(
        logProjectionSubjectUserId(principal),
        context.workspaceId,
        context.workspaceOrganizationId
      ),
    ])

    /**
     * Points are read a wave of runs at a time rather than one run at a time, and no
     * further wave starts once the page's point budget is spent, so a page cut short
     * reads at most one wave it then drops.
     */
    const runs: PausedRun[] = []
    let pointCount = 0
    let nextCursorKeys = page.nextCursorKeys
    let cut = false
    for (let start = 0; start < page.data.length && !cut; start += POINT_READ_CONCURRENCY) {
      const wave = page.data.slice(start, start + POINT_READ_CONCURRENCY)
      const pointsByRun = await Promise.all(
        wave.map((row) =>
          readPausedRunPoints({
            workflowId: row.workflowId,
            executionId: row.executionId,
            pausePoints: row.pausePoints,
            only: isWaitingHumanPausePoint,
          })
        )
      )
      for (const [offset, row] of wave.entries()) {
        const points = projectPausedRunPoints(pointsByRun[offset] ?? [], {
          projection,
          includeOutput: input.includeOutput,
        })
        if (runs.length > 0 && pointCount + points.length > V2_MAX_PAUSED_RUN_POINTS_PER_PAGE) {
          nextCursorKeys = pausedRunCursorKeys(page.data[start + offset - 1])
          cut = true
          break
        }
        pointCount += points.length
        runs.push({
          runId: row.executionId,
          workflowId: row.workflowId,
          workflowName: row.workflowName,
          pausedAt: row.pausedAt,
          points,
        })
      }
    }

    logger.info('Listed paused runs', {
      workspaceId: context.workspaceId,
      count: runs.length,
      principalKind: principal.kind,
    })
    return { runs, nextCursorKeys }
  },
})
