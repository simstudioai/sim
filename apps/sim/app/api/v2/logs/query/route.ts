import {
  type V2LogListItem,
  type V2QueryLogsRequest,
  v2LogStatusSchema,
  v2QueryLogsContract,
} from '@/lib/api/contracts/v2/logs'
import {
  canonicalUnorderedArray,
  cursorRoute,
  cursorScopeKey,
  instantScopePart,
} from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2LogErrorPolicies } from '@/lib/logs/api/route-policies'
import { logOperations } from '@/lib/logs/application/operations'
import { queryPublicLogs } from '@/lib/logs/application/query-public-logs'
import { LOG_FOLDER_SCOPE_VERSION } from '@/lib/logs/folder-scope'
import { cursorSortKey, encodeSortedCursor, readSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Every param that changes which runs, in which order, this query returns.
 *
 * The array-valued filters compile to `IN (...)` and `OR`, which are sets, so
 * they are canonicalized as sets — a caller that reorders an equivalent filter
 * mid-walk is asking for the same sequence and must not be refused.
 *
 * `folderScopeVersion` is stamped only when a folder filter is active. It is not
 * a contract param and never appears in `CURSOR_BINDINGS`: the sweep checks
 * declarations against what the contract accepts, and a route-side constant is
 * invisible to it by design. It exists because a folder path selects its whole
 * subtree, so a token minted under an older selection rule would decode cleanly
 * and resume inside a different sequence.
 */
function queryLogCursorScope(body: V2QueryLogsRequest): string {
  return cursorScopeKey(cursorRoute(v2QueryLogsContract), {
    workspaceId: body.workspaceId,
    workflowIds: body.workflowIds && canonicalUnorderedArray(body.workflowIds),
    folderPaths: body.folderPaths && canonicalUnorderedArray(body.folderPaths),
    folderScopeVersion: body.folderPaths ? LOG_FOLDER_SCOPE_VERSION : undefined,
    triggers: body.triggers && canonicalUnorderedArray(body.triggers),
    level: body.level,
    status: body.status && canonicalUnorderedArray(body.status),
    workflowName: body.workflowName,
    runId: body.runId,
    startDate: instantScopePart(body.startDate),
    endDate: instantScopePart(body.endDate),
    minDurationMs: body.minDurationMs,
    maxDurationMs: body.maxDurationMs,
    minCost: body.minCost,
    maxCost: body.maxCost,
    model: body.model,
  })
}

/**
 * The sortable read over a workspace's workflow runs.
 *
 * `GET /logs` deliberately keeps its single `order` param, whose justification is
 * that runs have exactly one sortable column. Adding columns there would falsify
 * that premise and force either a second spelling of the direction or a rename of
 * a shipped param, so the additional sorts live on this endpoint instead — the
 * same plain-page / rich-read split the table surface ships as `GET /rows` and
 * `POST /query`.
 */
export const POST = defineV2JsonRoute({
  contract: v2QueryLogsContract,
  auth: v2ApiKeyAuth,
  operation: logOperations.list,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2LogErrorPolicies.default,
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    filters: {
      workflowIds: body.workflowIds,
      triggers: body.triggers,
      level: body.level,
      statuses: body.status,
      workflowName: body.workflowName,
      executionId: body.runId,
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      minDurationMs: body.minDurationMs,
      maxDurationMs: body.maxDurationMs,
      minCost: body.minCost,
      maxCost: body.maxCost,
      model: body.model,
    },
    folderPaths: body.folderPaths,
    sortBy: body.sortBy,
    sortOrder: body.sortOrder,
    cursorKeys: readSortedCursor(
      body.cursor,
      body.sortBy,
      body.sortOrder,
      queryLogCursorScope(body)
    ),
    limit: body.limit,
  }),
  useCase: queryPublicLogs,
  present: ({ logs, nextCursorKeys }, { body }) => ({
    data: logs.map(
      (log): V2LogListItem => ({
        kind: 'workflow',
        runId: log.executionId,
        workflowId: log.workflowId,
        deploymentVersionId: log.deploymentVersionId,
        status: v2LogStatusSchema.parse(log.status),
        level: log.level,
        trigger: log.trigger,
        startedAt: log.startedAt.toISOString(),
        endedAt: log.endedAt ? log.endedAt.toISOString() : null,
        totalDurationMs: log.totalDurationMs,
        cost: log.costTotal != null ? { total: Number(log.costTotal) } : null,
        files: (log.files as unknown[] | null) ?? null,
        workflow: {
          id: log.workflowId,
          name: log.workflowName || 'Deleted Workflow',
          description: log.workflowDescription,
          deleted: !log.workflowName || log.workflowArchivedAt !== null,
        },
      })
    ),
    nextCursor: nextCursorKeys
      ? encodeSortedCursor(
          cursorSortKey(body.sortBy, body.sortOrder),
          nextCursorKeys,
          queryLogCursorScope(body)
        )
      : null,
  }),
})
