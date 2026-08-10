import { createLogger } from '@sim/logger'
import type { CursorKey } from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { workflowFolderPathForId } from '@/lib/workflows/application/workflow-folders'
import {
  InvalidWorkflowListCursorError,
  listWorkspaceWorkflows,
  type WorkflowSortBy,
  type WorkflowSortOrder,
} from '@/lib/workflows/queries'

const logger = createLogger('ListWorkflows')

export interface ListWorkflowsInput {
  workspaceId: string
  folderPath?: string
  deployedOnly: boolean
  search?: string
  sortBy: WorkflowSortBy
  sortOrder: WorkflowSortOrder
  cursorKeys?: CursorKey[]
  limit: number
}

export const listWorkflows = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.list,
  resolveContext: ({ input }: { input: ListWorkflowsInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }) {
    const folderIndex = await loadActiveFolderPathIndex(
      context.workspaceId,
      'workflow',
      undefined,
      { maxRows: MAX_FOLDERS_PER_WORKSPACE }
    )
    const folderId =
      input.folderPath === undefined
        ? undefined
        : input.folderPath === '/'
          ? null
          : folderIndex.idByPath.get(input.folderPath)
    if (input.folderPath !== undefined && folderId === undefined) {
      throw new OrchestrationError('not_found', 'Folder not found')
    }

    let page
    try {
      page = await listWorkspaceWorkflows({
        workspaceId: context.workspaceId,
        folderId,
        deployedOnly: input.deployedOnly,
        search: input.search,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
        cursorKeys: input.cursorKeys,
        limit: input.limit,
      })
    } catch (error) {
      if (error instanceof InvalidWorkflowListCursorError) {
        throw new OrchestrationError('validation', error.message)
      }
      throw error
    }

    logger.info('Listed workflows', {
      workspaceId: context.workspaceId,
      count: page.data.length,
      principalKind: principal.kind,
    })
    return {
      workflows: page.data.map((workflow) => ({
        ...workflow,
        workspaceId: workflow.workspaceId ?? context.workspaceId,
        folderPath: workflowFolderPathForId(folderIndex, workflow.folderId),
      })),
      nextCursorKeys: page.nextCursorKeys,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    }
  },
})
