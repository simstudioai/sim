import { type Principal, resolvePrincipalSubject } from '@sim/auth/principal'
import {
  type AuthorizedWorkspaceUseCaseDefinition,
  defineAuthorizedWorkspaceUseCase,
} from '@/lib/core/application/authorized-workspace-use-case'
import {
  isCopilotWorkspaceInvocation,
  markCopilotWorkspaceInvocation,
} from '@/lib/core/application/copilot-workspace-invocation'
import {
  authorizeWorkspaceOperation,
  type WorkspaceAuthorizationContext,
} from '@/lib/core/application/workspace-authorization'
import { withinAuthorizedWorkspaceOperation } from '@/lib/core/application/workspace-invocation-scope'
import type { WorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import { assertWorkspaceCapability } from '@/lib/permission-groups/capability-assertions'
import { getWorkspaceWithOwner, type WorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { assertForkingEnabled } from '@/ee/workspace-forking/lib/lineage/authz'
import { type ForkEdge, resolveForkEdge } from '@/ee/workspace-forking/lib/lineage/lineage'

export interface ForkApplicationContext extends WorkspaceAuthorizationContext {
  userId: string
  workspacePrincipals: Map<string, Principal>
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
    authorizationOptions: {
      delegation: { audience: 'sim:workspaces', isWithinScope: isCopilotWorkspaceInvocation },
    },
    async resolveContext({ input, principal }) {
      const subject = resolvePrincipalSubject(principal)
      if (subject?.kind !== 'sim_user') {
        throw new OrchestrationError('forbidden', 'Workspace forking requires an acting user')
      }
      const workspace = await getWorkspaceWithOwner(input.workspaceId, { includeArchived: false })
      if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')
      return {
        userId: subject.userId,
        workspacePrincipals: new Map([[workspace.id, principal]]),
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
        context.workspacePrincipals.set(
          other.id,
          await authorizeOtherForkWorkspace(principal, definition.operation, context, other)
        )
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

/** Called only after primary admission; nested checks keep the same actor and bounded lifetime. */
async function authorizeOtherForkWorkspace(
  principal: Principal,
  operation: WorkspaceOperation,
  context: ForkApplicationContext,
  other: WorkspaceWithOwner
): Promise<Principal> {
  const otherContext = {
    workspaceId: other.id,
    workspaceOrganizationId: other.organizationId,
    allowPersonalApiKeys: other.allowPersonalApiKeys,
  }
  let otherPrincipal = principal
  if (principal.kind === 'delegated') {
    if (
      !isCopilotWorkspaceInvocation(principal) ||
      other.organizationId !== context.workspaceOrganizationId
    ) {
      throw new OrchestrationError('not_found', 'Workspace not found in this organization')
    }
    otherPrincipal = Object.freeze({
      ...createCopilotChatPrincipal(
        { userId: context.userId, workspaceId: other.id, chatId: principal.resourceScope?.chatId },
        principal.audience
      ),
      expiresAt: principal.expiresAt,
    })
    markCopilotWorkspaceInvocation(otherPrincipal)
  }
  await withinAuthorizedWorkspaceOperation(() =>
    authorizeWorkspaceOperation(otherPrincipal, operation, otherContext, {
      delegation: { audience: 'sim:workspaces', isWithinScope: isCopilotWorkspaceInvocation },
    })
  )
  if (principal.kind === 'delegated' && other.organizationId) {
    /** permission-group-enforced: copilot.use — explicit secondary targets retain their own agent access. */
    await assertWorkspaceCapability(context.userId, other.id, 'copilot.use', other.organizationId)
  }
  return otherPrincipal
}
