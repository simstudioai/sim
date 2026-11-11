import { type V2PausedRun, v2ListPausedRunsContract } from '@/lib/api/contracts/v2/workflows'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { listPausedRuns } from '@/lib/workflows/application/list-paused-runs'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which paused runs, in which order, this list returns. */
function pausedRunCursorFilters(query: { workspaceId: string }) {
  return cursorScopeKey(cursorRoute(v2ListPausedRunsContract), {
    workspaceId: query.workspaceId,
  })
}

/** List a workspace's runs waiting on human input, with the points they wait at. */
export const GET = defineV2JsonRoute({
  contract: v2ListPausedRunsContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.listPausedRuns,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    includeOutput: query.includeOutput,
    sortOrder: query.sortOrder,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      pausedRunCursorFilters(query)
    ),
    limit: query.limit,
  }),
  useCase: listPausedRuns,
  present: ({ runs, nextCursorKeys }, { query }) => ({
    data: runs.map(
      (run): V2PausedRun => ({
        runId: run.runId,
        workflowId: run.workflowId,
        workflowName: run.workflowName,
        pausedAt: run.pausedAt.toISOString(),
        points: run.points,
      })
    ),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      pausedRunCursorFilters(query)
    ),
  }),
})
