import { and } from 'drizzle-orm'
import { MAX_STATS_WORKFLOWS } from '@/lib/api/contracts/logs'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { logOperations } from '@/lib/logs/application/operations'
import { folderScopeCondition, resolveLogFolderScope } from '@/lib/logs/folder-scope'
import { buildLogFilters, type LogFilters } from '@/lib/logs/public-filters'
import { buildDashboardStats, resolveLogStatsWindow } from '@/lib/logs/stats'
import { readLogStatsBounds, readLogStatsSegments } from '@/lib/logs/stats-queries'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface GetLogStatsInput {
  workspaceId: string
  filters: Omit<LogFilters, 'workspaceId' | 'folderIds' | 'cursor' | 'order'>
  folderPaths?: string[]
  segmentCount: number
}

export type GetLogStatsResult = ReturnType<typeof buildDashboardStats>

/**
 * Time-bucketed run counts, success counts, and mean latency for a workspace —
 * per workflow and in aggregate.
 *
 * The read and the aggregation are shared with the first-party dashboard
 * (`lib/logs/stats-queries.ts` and `lib/logs/stats.ts`); the authorization is
 * not. That route answers a caller without workspace access with a zeroed 200,
 * which this surface must not do, so the two deliberately meet below the
 * authorization boundary rather than at it.
 */
export const getLogStats = defineAuthorizedWorkspaceUseCase({
  operation: logOperations.readStats,
  resolveContext: async ({ input }: { input: GetLogStatsInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: {},
  execute: async ({ input, context }): Promise<GetLogStatsResult> => {
    const folderScope = input.folderPaths
      ? await resolveLogFolderScope(context.workspaceId, input.folderPaths)
      : undefined

    const where = and(
      buildLogFilters({ ...input.filters, workspaceId: context.workspaceId }),
      folderScope ? folderScopeCondition(folderScope) : undefined
    )

    const bounds = await readLogStatsBounds(where)
    const window = resolveLogStatsWindow(bounds, input.segmentCount)
    const rows = await readLogStatsSegments(where, window.startTime.toISOString(), window.segmentMs)
    return buildDashboardStats(rows, window, input.segmentCount, {
      maxWorkflows: MAX_STATS_WORKFLOWS,
    })
  },
})
