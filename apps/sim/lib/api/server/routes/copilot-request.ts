import type { DelegatedPrincipal } from '@sim/auth/principal'
import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application/operation'
import {
  type CopilotChatDelegationContext,
  createCopilotChatPrincipal,
} from '@/lib/mothership/auth/application-delegation'

/** A private in-process invocation, installed only after current chat/target authorization. Never a wire header. */
const INVOCATIONS = new WeakMap<Request, Readonly<CopilotChatDelegationContext>>()

export function markCopilotRequest(
  request: Request,
  invocation: CopilotChatDelegationContext
): void {
  INVOCATIONS.set(request, Object.freeze({ ...invocation }))
}

export function isCopilotRequest(request: Request): boolean {
  return INVOCATIONS.has(request)
}

/** The code-owned use case must explicitly admit Copilot and declare its domain audience. */
export function copilotRequestPrincipal(
  request: Request,
  operation: ApplicationOperation,
  useCase?: Pick<
    OperationUseCase<ApplicationOperation, unknown, unknown>,
    'operation' | 'delegationAudience'
  >
): DelegatedPrincipal | undefined {
  const invocation = INVOCATIONS.get(request)
  if (!invocation) return undefined
  if (useCase?.operation !== operation || !useCase.delegationAudience) return undefined
  const principal = createCopilotChatPrincipal(invocation, useCase.delegationAudience)
  markCopilotWorkspaceInvocation(principal)
  return principal
}
