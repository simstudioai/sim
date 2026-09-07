import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { isOrganizationFeatureEntitled } from '@/lib/billing/core/subscription'
import { ForbiddenOperationError, type OperationUseCase } from '@/lib/core/application'
import { isScimEnabled } from '@/lib/core/config/env-flags'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import type { ScimAdminOperation, ScimAdminPrincipal } from '@/lib/scim/application/operations'

/**
 * The authorized wrapper for administering a connection from the settings UI.
 *
 * Gate order is deliberate and each step is its own refusal, so a failure says
 * which rule stopped it: principal kind, then organization membership, then the
 * admin role, then the entitlement. Mirrors the organization BYOK and usage
 * wrappers rather than inventing a fourth shape.
 */

export interface ScimAdminContext {
  organizationId: string
  actorUserId: string
}

interface AuthorizedScimAdminDefinition<
  O extends ScimAdminOperation,
  I extends { organizationId: string },
  R,
> {
  operation: O
  execute(args: {
    principal: ScimAdminPrincipal
    input: I
    context: ScimAdminContext
    request?: OrchestrationRequestContext
  }): Promise<R>
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
      if (!(await isOrganizationFeatureEntitled(input.organizationId, isScimEnabled))) {
        throw new ForbiddenOperationError(
          'ENTERPRISE_PLAN_REQUIRED',
          'Directory provisioning requires an active enterprise subscription'
        )
      }

      return definition.execute({
        principal,
        input,
        context: { organizationId: input.organizationId, actorUserId: principal.userId },
        request,
      })
    },
  }
}
