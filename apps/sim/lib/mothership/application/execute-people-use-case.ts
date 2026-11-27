import type { OrganizationDelegatedPrincipal } from '@sim/auth/principal'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type CopilotExecutionContext,
  createTrustedOrganizationCopilotPrincipal,
  requireTrustedOrganizationCopilotContext,
} from '@/lib/mothership/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/mothership/chat/organization-chats'
import { peopleOperations } from '@/lib/people/application/operations'

interface CopilotPeopleScope {
  principal: OrganizationDelegatedPrincipal
  organizationId: string
}

/**
 * Runs a People directory read for the organization Assistant: the subject and organization come
 * from the trusted turn, the delegation is bound to the member's private chat, and the People use
 * cases the read calls still check the feature, the membership and the directory capability.
 */
export async function executeCopilotPeopleRead<R>(
  context: CopilotExecutionContext | undefined,
  read: (scope: CopilotPeopleScope) => Promise<R>
): Promise<R> {
  const trusted = requireTrustedOrganizationCopilotContext(context)
  const principal = createTrustedOrganizationCopilotPrincipal(
    { ...trusted, delegationId: trusted.toolCallId },
    {
      audience: peopleOperations.list.delegationAudience,
      ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    }
  )
  await authorizeOrganizationChatDelegation.execute({ principal })
  return read({ principal, organizationId: trusted.organizationId })
}
