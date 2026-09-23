import type { OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type CopilotExecutionContext,
  createTrustedOrganizationCopilotPrincipal,
  requireTrustedOrganizationCopilotContext,
} from '@/lib/mothership/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/mothership/chat/organization-chats'
import {
  type OrganizationWorkspaceOperation,
  organizationWorkspaceOperations,
} from '@/lib/workspaces/application/organization-operations'

/** Organization operations bind to the private chat, without inventing a workspace authority. */
export async function executeOrganizationWorkspaceUseCase<
  O extends OrganizationWorkspaceOperation,
  I,
  R,
>(
  context: CopilotExecutionContext | undefined,
  useCase: OperationUseCase<O, I & { organizationId: string }, R>,
  input: I
): Promise<R> {
  if (
    !Object.values(organizationWorkspaceOperations).some(
      (operation) => operation === useCase.operation
    )
  )
    throw new Error('Unregistered organization workspace operation')
  const trusted = requireTrustedOrganizationCopilotContext(context)
  if (context?.requestMode !== 'agent' && context?.requestMode !== 'plan')
    throw new OrchestrationError(
      'forbidden',
      'Workspace management requires organization agent mode'
    )
  const principal = createTrustedOrganizationCopilotPrincipal(
    { ...trusted, delegationId: trusted.toolCallId },
    { audience: useCase.operation.delegationAudience, ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS }
  )
  await authorizeOrganizationChatDelegation.execute({ principal })
  return useCase.execute({ principal, input: { ...input, organizationId: trusted.organizationId } })
}
