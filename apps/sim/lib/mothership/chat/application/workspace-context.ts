import {
  delegatedChatId,
  isUserChatDelegation,
  isWorkspaceDelegation,
  type Principal,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { defineWorkspaceOperation } from '@/lib/core/application'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import {
  authorizeChatWorkspaceTarget,
  WORKSPACE_TARGET_AUDIENCE,
} from '@/lib/mothership/chat/application/workspace-target'
import { requireAdmittedWorkspaceTarget } from '@/lib/mothership/request/application/run-authorization'
import {
  CAPABILITY_RULES,
  type StaticPermissionGroupCapability,
} from '@/lib/permission-groups/capabilities'
import { capabilityDeniedBy } from '@/lib/permission-groups/capability-assertions'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import { listOrganizationWorkspaces } from '@/lib/workspaces/application/list-organization-workspaces'

export const readWorkspaceContextOperation = defineWorkspaceOperation({
  id: 'mothership.chats.workspace_context',
  minimumRole: 'read',
  workspaceApiKey: 'deny',
  capability: 'copilot.use',
  contentDelivery: 'none',
  principalKinds: ['delegated'],
  delegatedServices: ['copilot'],
})

/** Repeatable private worker preflight; the inventory is not the memory mutation's result. */
export const readWorkspaceContext = defineAuthorizedChatUseCase({
  personal: true,
  executionDelegationAudience: WORKSPACE_TARGET_AUDIENCE,
  operation: readWorkspaceContextOperation,
  organizationOperation: defineOrganizationOperation({
    id: readWorkspaceContextOperation.id,
    contentDelivery: 'none',
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['organization_delegated'],
    delegatedServices: ['copilot'],
    delegationAudience: WORKSPACE_TARGET_AUDIENCE,
  }),
  async resolveContext({ principal }: { principal: Principal; input: { workspaceId: string } }) {
    const chatId = delegatedChatId(principal)
    if (!chatId) throw new OrchestrationError('not_found', 'Conversation not found')
    return resolveOwnedChatContext(principal, chatId)
  },
  authorizationOptions: {
    delegation: {
      audience: WORKSPACE_TARGET_AUDIENCE,
      isWithinScope: (principal, context) => delegatedChatId(principal) === context.chatId,
    },
  },
  async execute({ principal, executionPrincipal, input, context }) {
    await requireAdmittedWorkspaceTarget(executionPrincipal, input.workspaceId)
    if (
      (isUserChatDelegation(principal) && !context.organizationId && !context.workspaceId) ||
      (isWorkspaceDelegation(principal) && context.organizationId)
    ) {
      const grant = await authorizeChatWorkspaceTarget.execute({
        principal,
        input: { chatId: context.chatId, workspaceId: input.workspaceId },
      })
      const [target] = await db
        .select({
          id: workspace.id,
          name: workspace.name,
          allowPersonalApiKeys: workspace.allowPersonalApiKeys,
        })
        .from(workspace)
        .where(and(eq(workspace.id, grant.workspaceId), isNull(workspace.archivedAt)))
        .limit(1)
      if (!target || !grant.permission)
        throw new OrchestrationError('not_found', 'Workspace not found')
      const config = await resolvePermissionGroupConfig(
        context.userId,
        target.id,
        context.organizationId ?? null
      )
      const capabilities: Record<string, boolean> = {}
      for (const [id, rule] of Object.entries(CAPABILITY_RULES)) {
        if (rule.kind === 'static')
          capabilities[id] = !capabilityDeniedBy(id as StaticPermissionGroupCapability, config)
      }
      capabilities['personal_api_key.use'] &&= target.allowPersonalApiKeys
      return {
        success: true as const,
        workspaces: [
          {
            id: target.id,
            name: target.name,
            role: grant.permission,
            capabilityDetail: 'full' as const,
            capabilities,
          },
        ],
        nextCursor: null,
      }
    }
    if (
      principal.kind !== 'organization_delegated' ||
      !context.organizationId ||
      (context.mode !== 'agent' && context.mode !== 'plan')
    )
      throw new OrchestrationError(
        'forbidden',
        'Workspace discovery requires an organization agent conversation'
      )
    const result = await listOrganizationWorkspaces.execute({
      principal,
      input: { organizationId: context.organizationId, workspaceId: input.workspaceId, limit: 1 },
    })
    return { success: true as const, ...result }
  },
})
