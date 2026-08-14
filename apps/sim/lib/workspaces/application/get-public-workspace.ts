import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { workspaceOperations } from '@/lib/workspaces/application/operations'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import {
  getPublicWorkspaceDetail,
  type PublicWorkspaceDetail,
} from '@/lib/workspaces/public-queries'

export interface GetPublicWorkspaceInput {
  workspaceId: string
}

export interface GetPublicWorkspaceResult {
  workspace: PublicWorkspaceDetail
}

export const getPublicWorkspace = defineAuthorizedWorkspaceUseCase({
  operation: workspaceOperations.readPublicDetail,
  resolveContext: async ({ input }: { input: GetPublicWorkspaceInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: {},
  execute: async ({ context }): Promise<GetPublicWorkspaceResult> => {
    const workspace = await getPublicWorkspaceDetail(context.workspaceId)
    if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
    return { workspace }
  },
})
