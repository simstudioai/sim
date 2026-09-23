import type { DelegatedPrincipal, Principal } from '@sim/auth/principal'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** In-process admission evidence, never serialized into a job, token, checkpoint, or wire field. */
const ADMITTED = new WeakSet<DelegatedPrincipal>()

export function markCopilotWorkspaceInvocation(principal: DelegatedPrincipal): void {
  if (
    principal.serviceId !== 'copilot' ||
    !principal.subjectUserId ||
    !principal.workspaceId ||
    principal.expiresAt <= new Date()
  ) {
    throw new Error(
      'Private workspace invocation requires current subject-bearing Copilot delegation'
    )
  }
  ADMITTED.add(principal)
}

export function isCopilotWorkspaceInvocation(principal: DelegatedPrincipal): boolean {
  return (
    ADMITTED.has(principal) && principal.serviceId === 'copilot' && principal.expiresAt > new Date()
  )
}

/** Nested domain reads keep the admitted actor, resource restrictions, workspace, and expiry. */
export function bindCopilotWorkspaceOperation<P extends Principal>(
  principal: P,
  workspaceId: string,
  sourceAudiences: readonly string[],
  useCase: Pick<OperationUseCase<ApplicationOperation, unknown, unknown>, 'delegationAudience'>
): P {
  if (principal.kind !== 'delegated' || principal.serviceId !== 'copilot') return principal
  if (
    !isCopilotWorkspaceInvocation(principal) ||
    principal.workspaceId !== workspaceId ||
    !sourceAudiences.includes(principal.audience) ||
    !useCase.delegationAudience
  ) {
    throw new OrchestrationError(
      'forbidden',
      'Nested operation requires the current workspace invocation'
    )
  }
  const derived = { ...principal, audience: useCase.delegationAudience }
  if (derived.kind === 'delegated') markCopilotWorkspaceInvocation(derived)
  return derived
}
