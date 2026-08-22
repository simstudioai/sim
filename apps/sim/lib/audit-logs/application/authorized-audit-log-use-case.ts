import type { Principal } from '@sim/auth/principal'
import type { AuditLogOperation, AuditLogPrincipal } from '@/lib/audit-logs/application/operations'
import { resolveEnterpriseAuditAccess } from '@/lib/audit-logs/authorization'
import { ForbiddenOperationError, type OperationUseCase } from '@/lib/core/application'

export interface AuthorizedAuditLogContext {
  organizationId: string
  orgMemberIds: string[]
  actorUserId: string
}

interface AuthorizedAuditLogDefinition<O extends AuditLogOperation, I, R> {
  operation: O
  organizationId(input: I): string
  execute(args: {
    principal: AuditLogPrincipal
    input: I
    context: AuthorizedAuditLogContext
  }): Promise<R>
}

function requireAuditLogPrincipal(
  principal: Principal,
  operation: AuditLogOperation
): asserts principal is AuditLogPrincipal {
  if (!operation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new ForbiddenOperationError(
      'PRINCIPAL_KIND_NOT_PERMITTED',
      `Principal kind ${principal.kind} cannot perform operation ${operation.id}`
    )
  }
}

function auditActorUserId(principal: AuditLogPrincipal): string {
  return principal.userId
}

export function defineAuthorizedAuditLogUseCase<const O extends AuditLogOperation, I, R>(
  definition: AuthorizedAuditLogDefinition<O, I, R>
): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    async execute({ principal, input }) {
      requireAuditLogPrincipal(principal, definition.operation)
      const actorUserId = auditActorUserId(principal)
      const access = await resolveEnterpriseAuditAccess(
        actorUserId,
        definition.organizationId(input)
      )
      if (!access.success) throw new ForbiddenOperationError(access.code, access.message)
      return definition.execute({
        principal,
        input,
        context: { ...access.context, actorUserId },
      })
    },
  }
}
