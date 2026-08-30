import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { logDelegationAuthorization } from '@/lib/logs/application/authorization'
import { logOperations } from '@/lib/logs/application/operations'
import { materializeExecutionDataForDisplay } from '@/lib/logs/execution/trace-store'
import { resolveLogFolderScope } from '@/lib/logs/folder-scope'
import {
  assertLogCostQueryAllowed,
  type LogFieldProjection,
  projectExecutionData,
  resolveLogFieldProjection,
} from '@/lib/logs/log-projection'
import type { LogFilters } from '@/lib/logs/public-filters'
import {
  type PublicLogListRow,
  type PublicLogSortField,
  readPublicLogPage,
} from '@/lib/logs/public-queries'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface ListPublicLogsInput {
  workspaceId: string
  filters: Omit<LogFilters, 'workspaceId' | 'folderIds' | 'cursor' | 'order'>
  folderPaths?: string[]
  sortBy: PublicLogSortField
  sortOrder: ListSortOrder
  cursorKeys: CursorKey[] | undefined
  limit: number
  includeFullDetails: boolean
  includeFinalOutput: boolean
  includeTraceSpans: boolean
  includeJobRuns: boolean
}

export interface PublicLogApplicationItem {
  log: PublicLogListRow
  executionData?: Record<string, unknown>
}

export interface ListPublicLogsResult {
  items: PublicLogApplicationItem[]
  nextCursorKeys: CursorKey[] | null
  includeFullDetails: boolean
  includeFinalOutput: boolean
  includeTraceSpans: boolean
}

/**
 * The row with its spend blanked when the viewer's group withholds it.
 *
 * Blanked on the row rather than in the presenter so a surface that reads
 * `costTotal` or a job run's `cost` directly cannot report a figure the group
 * withholds by forgetting to ask. The two branches spell the same column
 * differently because the two tables do: a workflow run stores a `numeric`
 * total, a job run a jsonb document.
 */
function projectRowSpend(log: PublicLogListRow, projection: LogFieldProjection): PublicLogListRow {
  if (!projection.hideCostInfo) return log
  return log.kind === 'job' ? { ...log, cost: null } : { ...log, costTotal: null }
}

export const listPublicLogs = defineAuthorizedWorkspaceUseCase({
  operation: logOperations.list,
  resolveContext: async ({ input }: { input: ListPublicLogsInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: logDelegationAuthorization(),
  execute: async ({ principal, input, context }): Promise<ListPublicLogsResult> => {
    /**
     * Attribution and the projection subject in one value: a workspace API key
     * authorizes as the workspace and represents no user, so it resolves to
     * `undefined` and reads the page whole. Substituting the key's creator would
     * apply a bystander's group to every caller of a shared credential.
     */
    const viewerUserId = resolvePrincipalSubjectUserId(principal)

    /**
     * permission-group-enforced: logs.trace_spans
     * permission-group-enforced: logs.cost
     *
     * A projection rather than a refusal, for the reason
     * {@link resolveLogFieldProjection} gives — and applied here, in the use
     * case, rather than in the v2 presenter, so the withholding cannot be lost
     * by a second surface reading the same list.
     */
    const projection = await resolveLogFieldProjection(
      viewerUserId,
      context.workspaceId,
      context.workspaceOrganizationId
    )

    /**
     * Refused after the workspace role check above and before the read below:
     * `minCost`/`maxCost` bisect the very total the rows blank, and
     * `sortBy=cost` leaks the same figure as a ranking — see
     * {@link assertLogCostQueryAllowed}.
     */
    assertLogCostQueryAllowed(
      {
        sortBy: input.sortBy,
        minCost: input.filters.minCost,
        maxCost: input.filters.maxCost,
      },
      projection
    )

    const folderScope = input.folderPaths
      ? await resolveLogFolderScope(context.workspaceId, input.folderPaths)
      : undefined

    const needsMaterialization = input.includeFinalOutput || input.includeTraceSpans
    const { data, nextCursorKeys } = await readPublicLogPage({
      filters: { ...input.filters, workspaceId: context.workspaceId },
      limit: input.limit,
      includeExecutionData: needsMaterialization,
      folderScope,
      includeJobRuns: input.includeJobRuns,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      cursorKeys: input.cursorKeys,
    })

    /**
     * Job runs carry no materializable execution data on this surface: their
     * `execution_data` is a job envelope rather than a workflow trace, and
     * `materializeExecutionDataForDisplay` is keyed on a workflow. They pass
     * through unmaterialized rather than being handed a shape that does not
     * describe them.
     */
    const items = needsMaterialization
      ? await mapWithConcurrency(data, MATERIALIZE_CONCURRENCY, async (log) => {
          const projectedLog = projectRowSpend(log, projection)
          if (log.kind !== 'workflow' || !log.executionData) return { log: projectedLog }
          const materialized = await materializeExecutionDataForDisplay(
            log.executionData as Record<string, unknown>,
            {
              workspaceId: log.workspaceId,
              workflowId: log.workflowId,
              executionId: log.executionId,
              userId: viewerUserId,
            }
          )
          return {
            log: projectedLog,
            executionData: projectExecutionData(materialized, projection) as Record<
              string,
              unknown
            >,
          }
        })
      : data.map((log) => ({ log: projectRowSpend(log, projection) }))

    /**
     * The render flags are narrowed rather than left for the presenter to
     * re-check. `projectExecutionData` deletes the withheld payloads, but the
     * presenter reads `executionData.traceSpans ?? []`, so a deleted array would
     * come back as an empty one — present, and indistinguishable from a run
     * whose spans aged out. Turning the flag off omits the field instead.
     */
    return {
      items,
      nextCursorKeys,
      includeFullDetails: input.includeFullDetails,
      includeFinalOutput: input.includeFinalOutput && !projection.hideTraceSpans,
      includeTraceSpans: input.includeTraceSpans && !projection.hideTraceSpans,
    }
  },
})
