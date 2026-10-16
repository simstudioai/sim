import type { DelegatedPrincipal, ResourceDelegatedPrincipal } from '@sim/auth/principal'
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
type CopilotResourceRequestGrant = (
  operation: ApplicationOperation,
  audience: string
) => ResourceDelegatedPrincipal | undefined

type CopilotRequestInvocation =
  | { kind: 'resource'; grant: CopilotResourceRequestGrant }
  | { kind: 'workspace'; context: Readonly<CopilotChatDelegationContext> }

/** A private in-process invocation, installed only after current chat/target authorization. Never a wire header. */
const INVOCATIONS = new WeakMap<Request, CopilotRequestInvocation>()

export function markCopilotRequest(
  request: Request,
  invocation: CopilotChatDelegationContext
): void {
  INVOCATIONS.set(request, { kind: 'workspace', context: Object.freeze({ ...invocation }) })
}

/** Binds one request to a domain adapter's resource grant; the use case still reauthorizes current access. */
export function markCopilotResourceRequest(
  request: Request,
  grant: CopilotResourceRequestGrant
): void {
  INVOCATIONS.set(request, { kind: 'resource', grant })
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
): DelegatedPrincipal | ResourceDelegatedPrincipal | undefined {
  const invocation = INVOCATIONS.get(request)
  if (!invocation) return undefined
  const audience = copilotRouteAudience(operation, useCase)
  if (!audience) return undefined
  if (invocation.kind === 'resource') {
    const principal = invocation.grant(operation, audience)
    if (principal) noteContentDeliveryOperation(operation, principal)
    return principal
  }
  const principal = createCopilotChatPrincipal(invocation.context, audience)
  markCopilotWorkspaceInvocation(principal)
  noteContentDeliveryOperation(operation, principal)
  return principal
}
