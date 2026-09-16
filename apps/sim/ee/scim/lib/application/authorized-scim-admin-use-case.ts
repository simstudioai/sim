import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { ForbiddenOperationError, type OperationUseCase } from '@/lib/core/application'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { recordScimAuditEntries, type ScimAuditEntry } from '@/ee/scim/lib/application/audit'
import type { ScimAdminOperation, ScimAdminPrincipal } from '@/ee/scim/lib/application/operations'
import { isScimEntitledForOrganization } from '@/ee/scim/lib/entitlement'

/**
 * The authorized wrapper for administering a connection from the settings UI.
 *
 * Gate order is deliberate and each step is its own refusal, so a failure says
 * which rule stopped it: principal kind, then organization membership, then the
 * admin role, then the entitlement. Mirrors the organization BYOK and usage
 * wrappers rather than inventing a fourth shape, and mirrors the directory
 * wrapper's audit projection so both halves of the surface record audit the
 * same way.
 */

export interface ScimAdminContext {
  organizationId: string
  actorUserId: string
}

export interface ScimAdminUseCaseArgs<I> {
  principal: ScimAdminPrincipal
  input: I
  context: ScimAdminContext
  request?: OrchestrationRequestContext
}

export interface ScimAdminUseCaseResultArgs<I, R> extends ScimAdminUseCaseArgs<I> {
  result: R
}

interface AuthorizedScimAdminDefinition<
  O extends ScimAdminOperation,
  I extends { organizationId: string },
  R,
> {
  operation: O
  execute(args: ScimAdminUseCaseArgs<I>): Promise<R>
  /** Audit attributed to the administrator; the organization id is added for every entry. */
  projectAudit?(args: ScimAdminUseCaseResultArgs<I, R>): ScimAuditEntry | undefined
}

function requireScimAdminPrincipal(
  principal: Principal,
  operation: ScimAdminOperation
): asserts principal is ScimAdminPrincipal {
  if (principal.kind !== 'session') {
    throw new ForbiddenOperationError(
      'PRINCIPAL_KIND_NOT_PERMITTED',
      `Principal kind ${principal.kind} cannot perform operation ${operation.id}`
    )
  }
}

export function defineAuthorizedScimAdminUseCase<
  const O extends ScimAdminOperation,
  I extends { organizationId: string },
  R,
>(definition: AuthorizedScimAdminDefinition<O, I, R>): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    async execute({ principal, input, request }) {
      requireScimAdminPrincipal(principal, definition.operation)

      const [membership] = await db
        .select({ role: member.role })
        .from(member)
        .where(
          and(eq(member.organizationId, input.organizationId), eq(member.userId, principal.userId))
        )
        .limit(1)

      if (!membership) {
        throw new ForbiddenOperationError(
          'ORGANIZATION_MEMBERSHIP_REQUIRED',
          'Not a member of the requested organization'
        )
      }
      if (!definition.operation.organizationRoles.some((role) => role === membership.role)) {
        throw new ForbiddenOperationError(
          'ORGANIZATION_ADMIN_REQUIRED',
          'Organization admin or owner role required'
        )
      }
      if (!(await isScimEntitledForOrganization(input.organizationId))) {
        throw new ForbiddenOperationError(
          'ENTERPRISE_PLAN_REQUIRED',
          'Directory provisioning requires an active enterprise subscription'
        )
      }

      const context: ScimAdminContext = {
        organizationId: input.organizationId,
        actorUserId: principal.userId,
      }
      const result = await definition.execute({ principal, input, context, request })

      const entry = definition.projectAudit?.({ principal, input, context, request, result })
      if (entry) {
        recordScimAuditEntries({
          actorId: context.actorUserId,
          entries: [entry],
          metadata: { organizationId: context.organizationId },
          request,
        })
      }
      return result
    },
  }
}
