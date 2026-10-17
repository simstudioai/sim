import type { Principal, WorkspaceDelegatedPrincipal } from '@sim/auth/principal'
import {
  isWorkspaceDelegation,
  principalWorkspaceId,
  workspaceDelegationRestrictions,
} from '@sim/auth/principal'
import type { ApplicationOperation, OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** In-process admission evidence, never serialized into a job, token, checkpoint, or wire field. */
const ADMITTED = new WeakSet<WorkspaceDelegatedPrincipal>()

export function markCopilotWorkspaceInvocation(principal: WorkspaceDelegatedPrincipal): void {
  if (
    principal.serviceId !== 'copilot' ||
    !principal.subjectUserId ||
    !principalWorkspaceId(principal) ||
    principal.expiresAt <= new Date()
  ) {
    throw new Error(
      'Private workspace invocation requires current subject-bearing Copilot delegation'
    )
  }
  ADMITTED.add(principal)
}

export function isCopilotWorkspaceInvocation(
  principal: Principal
): principal is WorkspaceDelegatedPrincipal {
  return (
    isWorkspaceDelegation(principal) &&
    ADMITTED.has(principal) &&
    principal.serviceId === 'copilot' &&
    principal.expiresAt > new Date()
  )
}

const NESTED_RESOURCE_SCOPE_KEYS = ['fileId', 'tableId', 'credentialId', 'mcpServerId'] as const

export type NestedResourceScope = Partial<
  Record<(typeof NESTED_RESOURCE_SCOPE_KEYS)[number], string>
>

/** Adds the nested target to the admitted scope; a key already granted never moves to another resource. */
function narrowResourceScope(
  granted: ReturnType<typeof workspaceDelegationRestrictions>,
  target: NestedResourceScope
): NonNullable<ReturnType<typeof workspaceDelegationRestrictions>> {
  const scope = { ...granted }
  for (const key of NESTED_RESOURCE_SCOPE_KEYS) {
    const value = target[key]
    if (value === undefined) continue
    if (!value.trim() || (scope[key] !== undefined && scope[key] !== value)) {
      throw new OrchestrationError(
        'forbidden',
        'Nested operation cannot move its delegated resource scope'
      )
    }
    scope[key] = value
  }
  return Object.freeze(scope)
}

/**
 * Nested domain reads keep the admitted actor, resource restrictions, workspace, and expiry.
 * A nested operation bound to one resource names it in `resourceScope`, as the executor and
 * Chat tool paths do when they mint a principal for that resource.
 */
export function bindCopilotWorkspaceOperation<P extends Principal>(
  principal: P,
  workspaceId: string,
  sourceAudiences: readonly string[],
  useCase: Pick<OperationUseCase<ApplicationOperation, unknown, unknown>, 'delegationAudience'>,
  resourceScope?: NestedResourceScope
): P {
  if (principal.kind !== 'delegated' || principal.serviceId !== 'copilot') return principal
  if (
    !isWorkspaceDelegation(principal) ||
    !isCopilotWorkspaceInvocation(principal) ||
    principalWorkspaceId(principal) !== workspaceId ||
    !sourceAudiences.includes(principal.audience) ||
    !useCase.delegationAudience
  ) {
    throw new OrchestrationError(
      'forbidden',
      'Nested operation requires the current workspace invocation'
    )
  }
  const derived = {
    ...principal,
    audience: useCase.delegationAudience,
    ...(resourceScope
      ? {
          grant: {
            ...principal.grant,
            restrictions: narrowResourceScope(
              workspaceDelegationRestrictions(principal),
              resourceScope
            ),
          },
        }
      : {}),
  }
  if (derived.kind === 'delegated') markCopilotWorkspaceInvocation(derived)
  return derived
}
