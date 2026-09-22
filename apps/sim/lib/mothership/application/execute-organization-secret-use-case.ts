import type { OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type CopilotExecutionContext,
  createTrustedOrganizationCopilotPrincipal,
  requireTrustedOrganizationCopilotContext,
} from '@/lib/mothership/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/mothership/chat/organization-chats'
import { organizationSecretOperations } from '@/lib/organization-secrets/application/operations'

const runtimeOperations = [
  organizationSecretOperations.listNames,
  organizationSecretOperations.mount,
] as const

/** Binds Generic Secrets to the authenticated private Build conversation and current membership. */
export async function executeOrganizationSecretUseCase<I extends { organizationId: string }, R>(
  context: CopilotExecutionContext,
  useCase: OperationUseCase<(typeof runtimeOperations)[number], I, R>,
  input: Omit<I, 'organizationId'>
): Promise<R> {
  if (!runtimeOperations.some((operation) => operation === useCase.operation)) {
    throw new Error('Unregistered organization secret operation')
  }
  const trusted = requireTrustedOrganizationCopilotContext(context)
  if (context.requestMode !== 'agent')
    throw new OrchestrationError('forbidden', 'Generic Secrets require Build mode')
  const principal = createTrustedOrganizationCopilotPrincipal(
    { ...trusted, delegationId: trusted.toolCallId },
    { audience: useCase.operation.delegationAudience, ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS }
  )
  await authorizeOrganizationChatDelegation.execute({ principal, mode: 'agent' })
  return useCase.execute({
    principal,
    input: { ...input, organizationId: trusted.organizationId } as I,
  })
}
