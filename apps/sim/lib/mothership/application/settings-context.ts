import type { DelegatedPrincipal, OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import type { MothershipSettingsScope } from '@/lib/api/contracts/mothership-settings'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
  requireTrustedCopilotExecutionContext,
  requireTrustedOrganizationCopilotContext,
} from '@/lib/mothership/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/mothership/chat/organization-chats'
import type { ServerToolContext } from '@/lib/mothership/tools/server/base-tool'
import { readSettingsWorkspaceContext } from '@/lib/settings/application/context'

export interface SettingsContext {
  principal: DelegatedPrincipal | OrganizationDelegatedPrincipal
  scope: MothershipSettingsScope
  workspaceId?: string
  organizationId?: string
}

/** The model selects a scope; its owner and acting user come from verified conversation authority. */
export async function resolveSettingsContext(
  scope: MothershipSettingsScope,
  context: ServerToolContext | undefined,
  assertedWorkspaceId?: string
): Promise<SettingsContext> {
  if (context?.requestMode === 'assistant')
    throw new OrchestrationError('forbidden', 'Settings management requires agent mode')
  const delegation = { audience: 'sim:settings', ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS }
  if (context?.organizationId) {
    const trusted = requireTrustedOrganizationCopilotContext(context)
    if (scope === 'workspace')
      throw new OrchestrationError(
        'validation',
        'Workspace settings require an explicit workspace target'
      )
    if (assertedWorkspaceId)
      throw new OrchestrationError(
        'validation',
        'Account and organization settings do not take a workspace target'
      )
    const principal = createTrustedOrganizationCopilotPrincipal(
      { ...trusted, delegationId: trusted.toolCallId },
      delegation
    )
    await authorizeOrganizationChatDelegation.execute({ principal })
    return { principal, scope, organizationId: trusted.organizationId }
  }
  const trusted = requireTrustedCopilotExecutionContext(context)
  if (assertedWorkspaceId && assertedWorkspaceId !== trusted.workspaceId)
    throw new OrchestrationError('not_found', 'Workspace not found in this conversation')
  await resolveInvocationWorkspace(
    { ...trusted, chatOrganizationId: context?.chatOrganizationId },
    context?.chatOrganizationId ? trusted.workspaceId : undefined
  )
  const principal = createTrustedCopilotPrincipal(
    { ...trusted, delegationId: trusted.toolCallId },
    delegation
  )
  const host = await readSettingsWorkspaceContext.execute({ principal, input: {} })
  if (scope !== 'organization')
    return { principal, scope, ...host, organizationId: host.organizationId ?? undefined }
  if (!host.organizationId || !trusted.chatId)
    throw new OrchestrationError('not_found', 'This workspace has no organization settings')
  return {
    scope,
    organizationId: host.organizationId,
    principal: createTrustedOrganizationCopilotPrincipal(
      {
        userId: trusted.userId,
        organizationId: host.organizationId,
        chatId: trusted.chatId,
        delegationId: trusted.toolCallId,
      },
      delegation
    ),
  }
}
