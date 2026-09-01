import { type AuditActionType, type AuditResourceTypeValue, recordAudit } from '@sim/audit'
import { resolvePrincipalAuditAttribution, type SessionPrincipal } from '@sim/auth/principal'
import type { OperationUseCase } from '@/lib/core/application'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { CredentialUserOperation } from '@/lib/credentials/application/operations'

export interface CredentialUserAuditEntry {
  workspaceId: string | null
  action: AuditActionType
  resourceType: AuditResourceTypeValue
  resourceId?: string
  resourceName?: string
  description?: string
  metadata?: Record<string, unknown>
}

interface CredentialUserUseCaseDefinition<O extends CredentialUserOperation, I, R> {
  operation: O
  execute(args: {
    principal: SessionPrincipal
    input: I
    request?: OrchestrationRequestContext
  }): Promise<R>
  projectAudit?(args: {
    principal: SessionPrincipal
    input: I
    result: R
  }): CredentialUserAuditEntry | CredentialUserAuditEntry[]
  projectErrorAudit?(args: {
    principal: SessionPrincipal
    input: I
    error: unknown
  }): CredentialUserAuditEntry | CredentialUserAuditEntry[] | undefined
  afterSuccess?(args: { principal: SessionPrincipal; input: I; result: R }): void | Promise<void>
  afterError?(args: { principal: SessionPrincipal; input: I; error: unknown }): void | Promise<void>
}

function recordCredentialUserAudit(
  principal: SessionPrincipal,
  operation: CredentialUserOperation,
  projected: CredentialUserAuditEntry | CredentialUserAuditEntry[] | undefined,
  request?: OrchestrationRequestContext
): void {
  if (!projected) return
  const attribution = resolvePrincipalAuditAttribution(principal)
  const entries = Array.isArray(projected) ? projected : [projected]
  for (const entry of entries) {
    recordAudit({
      workspaceId: entry.workspaceId,
      actorId: attribution.actorId,
      actorName: attribution.actorName,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      resourceName: entry.resourceName,
      description: entry.description,
      metadata: {
        ...entry.metadata,
        operation: operation.id,
        actor: attribution.actor,
      },
      request,
    })
  }
}

/** Defines a current-user credential operation that cannot borrow workspace identity. */
export function defineAuthorizedCredentialUserUseCase<
  const O extends CredentialUserOperation,
  I,
  R,
>(definition: CredentialUserUseCaseDefinition<O, I, R>): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    async execute({ principal, input, request }) {
      if (principal.kind !== 'session') {
        throw new OrchestrationError('forbidden', 'Session authentication required')
      }
      try {
        const result = await definition.execute({ principal, input, request })
        recordCredentialUserAudit(
          principal,
          definition.operation,
          definition.projectAudit?.({ principal, input, result }),
          request
        )
        await definition.afterSuccess?.({ principal, input, result })
        return result
      } catch (error) {
        recordCredentialUserAudit(
          principal,
          definition.operation,
          definition.projectErrorAudit?.({ principal, input, error }),
          request
        )
        await definition.afterError?.({ principal, input, error })
        throw error
      }
    },
  }
}
