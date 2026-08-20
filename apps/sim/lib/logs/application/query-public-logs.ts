import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { logOperations } from '@/lib/logs/application/operations'
import { resolveLogFolderScope } from '@/lib/logs/folder-scope'
import type { LogFilters } from '@/lib/logs/public-filters'
import {
  type PublicLogSortField,
  type PublicWorkflowLogListRow,
  queryPublicWorkflowLogs,
} from '@/lib/logs/public-queries'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface QueryPublicLogsInput {
  workspaceId: string
  filters: Omit<LogFilters, 'workspaceId' | 'folderIds' | 'cursor' | 'order'>
  folderPaths?: string[]
  sortBy: PublicLogSortField
  sortOrder: ListSortOrder
  cursorKeys: CursorKey[] | undefined
  limit: number
}

export interface QueryPublicLogsResult {
  logs: PublicWorkflowLogListRow[]
  nextCursorKeys: CursorKey[] | null
}

/**
 * The sortable read over a workspace's workflow runs.
 *
 * Shares `logOperations.list` with `GET /logs`: same resource, same role, same
 * principals, same rows — only the ordering and the request shape differ, which
 * is a surface concern rather than a new semantic operation.
 */
export const queryPublicLogs = defineAuthorizedWorkspaceUseCase({
  operation: logOperations.list,
  resolveContext: async ({ input }: { input: QueryPublicLogsInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: {},
  execute: async ({ input, context }): Promise<QueryPublicLogsResult> => {
    const folderScope = input.folderPaths
      ? await resolveLogFolderScope(context.workspaceId, input.folderPaths)
      : undefined

    const { data, nextCursorKeys } = await queryPublicWorkflowLogs({
      filters: { ...input.filters, workspaceId: context.workspaceId },
      folderScope,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      cursorKeys: input.cursorKeys,
      limit: input.limit,
    })

    return { logs: data, nextCursorKeys }
  },
})
