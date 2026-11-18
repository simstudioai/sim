import { v2ListWorkspaceSchedulesContract } from '@/lib/api/contracts/v2/workflows'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { presentV2WorkspaceSchedule } from '@/lib/workflows/api'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { listWorkspaceSchedules } from '@/lib/workflows/application/triggers'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which schedules this list returns. */
function scheduleCursorFilters(query: { workspaceId: string }) {
  return cursorScopeKey(cursorRoute(v2ListWorkspaceSchedulesContract), {
    workspaceId: query.workspaceId,
  })
}

/**
 * GET /api/v2/schedules — health and timing of every schedule the workspace's
 * deployed workflows run, disabled ones included.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListWorkspaceSchedulesContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.readTriggers,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      scheduleCursorFilters(query)
    ),
  }),
  useCase: listWorkspaceSchedules,
  present: ({ schedules, nextCursorKeys }, { query }) => ({
    data: schedules.map(presentV2WorkspaceSchedule),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      scheduleCursorFilters(query)
    ),
  }),
})
