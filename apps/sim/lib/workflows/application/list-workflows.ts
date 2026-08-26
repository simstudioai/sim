import { createLogger } from '@sim/logger'
import type { CursorKey } from '@/lib/api/list-query'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex, resolveFolderPathFilter } from '@/lib/folders/queries'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  archivableWorkflowFolderPath,
  workflowFolderPathForId,
} from '@/lib/workflows/application/workflow-folders'
import {
  listWorkspaceWorkflows,
  type WorkflowSortBy,
  type WorkflowSortOrder,
} from '@/lib/workflows/queries'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const logger = createLogger('ListWorkflows')

export interface ListWorkflowsInput {
  workspaceId: string
  folderPath?: string
  scope: 'active' | 'archived'
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
    const folderFilter = resolveFolderPathFilter(folderIndex, input.folderPath)
    if (folderFilter.kind === 'noMatch') {
      return {
        workflows: [],
        nextCursorKeys: null,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
      }
    }

    const page = await listWorkspaceWorkflows({
      workspaceId: context.workspaceId,
      folderId: folderFilter.kind === 'folder' ? folderFilter.folderId : undefined,
      scope: input.scope,
      deployedOnly: input.deployedOnly,
      search: input.search,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      cursorKeys: input.cursorKeys,
      limit: input.limit,
    })

    logger.info('Listed workflows', {
      workspaceId: context.workspaceId,
      count: page.data.length,
      principalKind: principal.kind,
    })
    return {
      workflows: page.data.map((workflow) => ({
        ...workflow,
        workspaceId: workflow.workspaceId ?? context.workspaceId,
        folderPath:
          input.scope === 'archived'
            ? archivableWorkflowFolderPath(folderIndex, workflow.folderId)
            : workflowFolderPathForId(folderIndex, workflow.folderId),
      })),
      nextCursorKeys: page.nextCursorKeys,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    }
  },
})
