import {
  type AuthorizedWorkspaceUseCaseDefinition,
  defineAuthorizedWorkspaceUseCase,
} from '@/lib/core/application/authorized-workspace-use-case'
import {
  authorizeWorkspaceOperation,
  type WorkspaceAuthorizationContext,
} from '@/lib/core/application/workspace-authorization'
import type { WorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getWorkspaceWithOwner, type WorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { assertForkingEnabled } from '@/ee/workspace-forking/lib/lineage/authz'
import { type ForkEdge, resolveForkEdge } from '@/ee/workspace-forking/lib/lineage/lineage'

export interface ForkApplicationContext extends WorkspaceAuthorizationContext {
  workspace: WorkspaceWithOwner
  other?: WorkspaceWithOwner
  edge?: ForkEdge
}

/** Adapters share the same current-principal checks on each side of a canonical fork edge. */
export function defineForkUseCase<
  const O extends WorkspaceOperation,
  I extends { workspaceId: string; otherWorkspaceId?: string },
  R,
>(
  definition: Pick<
    AuthorizedWorkspaceUseCaseDefinition<O, I, ForkApplicationContext, R>,
    'operation' | 'execute' | 'projectAudit' | 'afterSuccess'
  > & { bothSides?: boolean; edge?: boolean; availability?: boolean }
) {
  return defineAuthorizedWorkspaceUseCase<O, I, ForkApplicationContext, R>({
    ...definition,
    authorizationOptions: {},
    async resolveContext({ input }) {
      const workspace = await getWorkspaceWithOwner(input.workspaceId, { includeArchived: false })
      if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
      return {
        workspace,
        workspaceId: workspace.id,
        workspaceOrganizationId: workspace.organizationId,
        allowPersonalApiKeys: workspace.allowPersonalApiKeys,
      }
    },
    async authorizeResource({ principal, input, context }) {
      if (!definition.availability) await assertForkingEnabled(context.workspace.organizationId)
      if (definition.bothSides) {
        if (!input.otherWorkspaceId)
          throw new OrchestrationError('validation', 'otherWorkspaceId is required')
        const other = await getWorkspaceWithOwner(input.otherWorkspaceId, {
          includeArchived: false,
        })
        if (!other) throw new OrchestrationError('not_found', 'Workspace not found')
        await authorizeWorkspaceOperation(principal, definition.operation, {
          workspaceId: other.id,
          workspaceOrganizationId: other.organizationId,
          allowPersonalApiKeys: other.allowPersonalApiKeys,
        })
        await assertForkingEnabled(other.organizationId)
        context.other = other
      }
      if (definition.edge) {
        if (!input.otherWorkspaceId)
          throw new OrchestrationError('validation', 'otherWorkspaceId is required')
        const edge = await resolveForkEdge(context.workspaceId, input.otherWorkspaceId)
        if (!edge)
          throw new OrchestrationError('validation', 'These workspaces are not a direct fork edge')
        context.edge = edge
      }
    },
  })
}
