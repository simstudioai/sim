import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { workspaceOperations } from '@/lib/workspaces/application/operations'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import {
  queryPublicWorkspaceMembers,
  type WorkspaceMemberPage,
} from '@/lib/workspaces/public-queries'

export interface ListPublicWorkspaceMembersInput {
  workspaceId: string
  limit: number
  afterEmail?: string
}

export interface ListPublicWorkspaceMembersResult {
  page: WorkspaceMemberPage
}

export const listPublicWorkspaceMembers = defineAuthorizedWorkspaceUseCase({
  operation: workspaceOperations.listPublicMembers,
  resolveContext: async ({ input }: { input: ListPublicWorkspaceMembersInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: {},
  execute: async ({ input, context }): Promise<ListPublicWorkspaceMembersResult> => {
    const page = await queryPublicWorkspaceMembers(context.workspaceId, {
      limit: input.limit,
      afterEmail: input.afterEmail,
    })
    if (!page) throw new OrchestrationError('not_found', 'Workspace not found')
    return { page }
  },
})
