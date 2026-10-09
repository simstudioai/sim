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

export type CopilotRouteUseCase = Pick<
  OperationUseCase<ApplicationOperation, unknown, unknown>,
  'operation' | 'delegationAudience'
>

/**
 * The audience a route admits Copilot under, or none when Mothership is refused. The
 * code-owned use case must explicitly admit Copilot and declare its domain audience. The
 * route inventory evaluates this same rule to publish which CLI commands chat can run.
 */
export function copilotRouteAudience(
  operation: ApplicationOperation,
  useCase?: CopilotRouteUseCase
): string | undefined {
  return useCase?.operation === operation ? useCase.delegationAudience || undefined : undefined
}

export function copilotRequestPrincipal(
  request: Request,
  operation: ApplicationOperation,
  useCase?: CopilotRouteUseCase
): DelegatedPrincipal | undefined {
  const invocation = INVOCATIONS.get(request)
  if (!invocation) return undefined
  const audience = copilotRouteAudience(operation, useCase)
  if (!audience) return undefined
  const principal = createCopilotChatPrincipal(invocation, audience)
  markCopilotWorkspaceInvocation(principal)
  return principal
}
