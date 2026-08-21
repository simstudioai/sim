import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { logOperations } from '@/lib/logs/application/operations'
import { materializeExecutionDataForDisplay } from '@/lib/logs/execution/trace-store'
import { resolveLogFolderScope } from '@/lib/logs/folder-scope'
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

export const listPublicLogs = defineAuthorizedWorkspaceUseCase({
  operation: logOperations.list,
  resolveContext: async ({ input }: { input: ListPublicLogsInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: {},
  execute: async ({ principal, input, context }): Promise<ListPublicLogsResult> => {
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

    const userId = principal.kind === 'personal_api_key' ? principal.userId : undefined
    /**
     * Job runs carry no materializable execution data on this surface: their
     * `execution_data` is a job envelope rather than a workflow trace, and
     * `materializeExecutionDataForDisplay` is keyed on a workflow. They pass
     * through unmaterialized rather than being handed a shape that does not
     * describe them.
     */
    const items = needsMaterialization
      ? await mapWithConcurrency(data, MATERIALIZE_CONCURRENCY, async (log) => {
          if (log.kind !== 'workflow' || !log.executionData) return { log }
          return {
            log,
            executionData: await materializeExecutionDataForDisplay(
              log.executionData as Record<string, unknown>,
              {
                workspaceId: log.workspaceId,
                workflowId: log.workflowId,
                executionId: log.executionId,
                userId,
              }
            ),
          }
        })
      : data.map((log) => ({ log }))

    return {
      items,
      nextCursorKeys,
      includeFullDetails: input.includeFullDetails,
      includeFinalOutput: input.includeFinalOutput,
      includeTraceSpans: input.includeTraceSpans,
    }
  },
})
