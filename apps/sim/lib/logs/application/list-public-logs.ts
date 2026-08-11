import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MATERIALIZE_CONCURRENCY, mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { logOperations } from '@/lib/logs/application/operations'
import { materializeExecutionDataForDisplay } from '@/lib/logs/execution/trace-store'
import type { LogFilters } from '@/lib/logs/public-filters'
import { listPublicWorkflowLogs } from '@/lib/logs/public-queries'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

type PublicLogRow = Awaited<ReturnType<typeof listPublicWorkflowLogs>>['data'][number]

export interface ListPublicLogsInput {
  workspaceId: string
  filters: Omit<LogFilters, 'workspaceId' | 'folderIds'>
  folderPaths?: string[]
  limit: number
  includeFullDetails: boolean
  includeFinalOutput: boolean
  includeTraceSpans: boolean
}

export interface PublicLogApplicationItem {
  log: PublicLogRow
  executionData?: Record<string, unknown>
}

export interface ListPublicLogsResult {
  items: PublicLogApplicationItem[]
  nextCursor: string | null
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
    const folderIndex = input.folderPaths
      ? await loadActiveFolderPathIndex(context.workspaceId, 'workflow')
      : null
    const resolvedFolderIds = input.folderPaths?.map((path) =>
      path === ROOT_FOLDER_PATH ? null : folderIndex?.idByPath.get(path)
    )
    if (resolvedFolderIds?.some((folderId) => folderId === undefined)) {
      throw new OrchestrationError('not_found', 'Folder not found')
    }

    const folderIds = resolvedFolderIds?.filter(
      (folderId): folderId is string => typeof folderId === 'string'
    )
    const includesRoot = resolvedFolderIds?.includes(null) ?? false
    const needsMaterialization = input.includeFinalOutput || input.includeTraceSpans
    const { data, nextCursor } = await listPublicWorkflowLogs({
      filters: { ...input.filters, workspaceId: context.workspaceId, folderIds },
      limit: input.limit,
      includeExecutionData: needsMaterialization,
      folderScope: input.folderPaths ? { includesRoot, folderIds: folderIds ?? [] } : undefined,
    })

    const userId = principal.kind === 'personal_api_key' ? principal.userId : undefined
    const items = needsMaterialization
      ? await mapWithConcurrency(data, MATERIALIZE_CONCURRENCY, async (log) => {
          if (!log.executionData) return { log }
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
      nextCursor,
      includeFullDetails: input.includeFullDetails,
      includeFinalOutput: input.includeFinalOutput,
      includeTraceSpans: input.includeTraceSpans,
    }
  },
})
