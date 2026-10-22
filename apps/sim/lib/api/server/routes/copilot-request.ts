import type { SubjectDelegatedPrincipal, WorkspaceSubjectDelegation } from '@sim/auth/principal'
import { noteContentDeliveryOperation } from '@/lib/core/application'
import { markCopilotWorkspaceInvocation } from '@/lib/core/application/copilot-workspace-invocation'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application/operation'
import {
  type CopilotChatDelegationContext,
  createCopilotChatPrincipal,
} from '@/lib/mothership/auth/application-delegation'

/**
 * Mints the resource grant one admitted request carries for an operation the route runs under
 * the given audience, or none when that operation is outside the grant. Owned by the domain
 * adapter that bound the request, so this route layer stays free of domain policy.
 */
type CopilotRequestGrant = (
  operation: ApplicationOperation,
  audience: string
) => SubjectDelegatedPrincipal | undefined

/** In-process authority factory installed after current invocation and target authorization. */
const INVOCATIONS = new WeakMap<Request, CopilotRequestGrant>()

/** Binds one operation-specific grant factory; application authorization still checks current access. */
export function markCopilotRequest(request: Request, grant: CopilotRequestGrant): void {
  INVOCATIONS.set(request, grant)
}

/** Adapts the existing trusted workspace invocation to the common request-grant contract. */
export function createWorkspaceRequestGrant(
  context: CopilotChatDelegationContext
): CopilotRequestGrant {
  const invocation = Object.freeze({ ...context })
  return (_operation, audience): WorkspaceSubjectDelegation => {
    const principal = createCopilotChatPrincipal(invocation, audience)
    markCopilotWorkspaceInvocation(principal)
    return principal
  }
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
  if (useCase?.operation !== operation) return undefined
  // An operation that names its delegated services without `copilot` is refused before minting.
  const services: readonly string[] | undefined =
    'delegatedServices' in operation
      ? (operation.delegatedServices as readonly string[])
      : undefined
  if (services && !services.includes('copilot')) return undefined
  return useCase.delegationAudience || undefined
}

export function copilotRequestPrincipal(
  request: Request,
  operation: ApplicationOperation,
  useCase?: CopilotRouteUseCase
): SubjectDelegatedPrincipal | undefined {
  const invocation = INVOCATIONS.get(request)
  if (!invocation) return undefined
  const audience = copilotRouteAudience(operation, useCase)
  if (!audience) return undefined
  const principal = invocation(operation, audience)
  if (principal) noteContentDeliveryOperation(operation, principal)
  return principal
}
