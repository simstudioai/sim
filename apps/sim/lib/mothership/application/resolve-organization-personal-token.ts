import type { OperationUseCase } from '@/lib/core/application'
import {
  prepareOrganizationPersonalConnection,
  type ResolveOrganizationPersonalTokenInput,
  resolveOrganizationPersonalToken,
} from '@/lib/credentials/application/resolve-organization-personal-token'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  type CopilotExecutionContext,
  createTrustedOrganizationCopilotPrincipal,
  requireTrustedOrganizationCopilotContext,
} from '@/lib/mothership/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/mothership/chat/organization-chats'

const operations = [
  resolveOrganizationPersonalToken.operation,
  prepareOrganizationPersonalConnection.operation,
] as const

/** Shared authority normalization for the registered organization personal-account operations. */
export async function executeCopilotOrganizationCredentialUseCase<
  I extends { organizationId: string },
  R,
>(
  context: CopilotExecutionContext,
  useCase: OperationUseCase<(typeof operations)[number], I, R>,
  input: Omit<I, 'organizationId'>
): Promise<R> {
  if (!operations.some((operation) => operation === useCase.operation))
    throw new Error('Unregistered organization credential operation')
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

/** Token authority comes from the authenticated private conversation, never model arguments. */
export async function resolveCopilotOrganizationPersonalToken(
  context: CopilotExecutionContext,
  input: Omit<ResolveOrganizationPersonalTokenInput, 'organizationId'>
) {
  return executeCopilotOrganizationCredentialUseCase(
    context,
    resolveOrganizationPersonalToken,
    input
  )
}
