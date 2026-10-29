import {
  authorizeOrganizationAssistantRead,
  claimOrganizationAssistantAction,
  prepareOrganizationAssistantAction,
} from '@/lib/assistant-actions/application/admission'
import type { OperationUseCase } from '@/lib/core/application'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type CopilotExecutionContext,
  createTrustedOrganizationCopilotPrincipal,
  requireTrustedOrganizationCopilotContext,
} from '@/lib/mothership/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/mothership/chat/organization-chats'

const operations = [
  prepareOrganizationAssistantAction.operation,
  claimOrganizationAssistantAction.operation,
  authorizeOrganizationAssistantRead.operation,
] as const

/** Account policy is authorized for the authenticated private conversation, never model identity fields. */
export async function executeCopilotAssistantAction<I extends { organizationId: string }, R>(
  context: CopilotExecutionContext,
  useCase: OperationUseCase<(typeof operations)[number], I, R>,
  input: Omit<I, 'organizationId'>
): Promise<R> {
  if (
    context.requestMode !== 'assistant' ||
    !operations.some((operation) => operation === useCase.operation)
  )
    throw new Error('Unregistered Assistant action operation')
  const trusted = requireTrustedOrganizationCopilotContext(context)
  const principal = createTrustedOrganizationCopilotPrincipal(
    { ...trusted, delegationId: trusted.toolCallId },
    { audience: useCase.operation.delegationAudience, ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS }
  )
  await authorizeOrganizationChatDelegation.execute({ principal })
  return useCase.execute({
    principal,
    input: { ...input, organizationId: trusted.organizationId } as I,
  })
}
