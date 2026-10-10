import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type {
  OrganizationBillingOperation,
  OrganizationBillingPrincipal,
} from '@/lib/billing/application/organization-billing/operations'
import { organizationBillingSettingsActor } from '@/lib/billing/application/organization-settings-actor'
import { ForbiddenOperationError, type OperationUseCase } from '@/lib/core/application'

interface AuthorizedOrganizationBillingContext {
  organizationId: string
  actorUserId: string
  userRole: 'admin' | 'owner'
}

interface AuthorizedOrganizationBillingDefinition<O extends OrganizationBillingOperation, I, R> {
  operation: O
  organizationId(input: I): string
  execute(args: {
    principal: OrganizationBillingPrincipal
    input: I
    context: AuthorizedOrganizationBillingContext
  }): Promise<R>
}

function requireBillingSettingsPrincipal(
  principal: Principal,
  operation: OrganizationBillingOperation
): asserts principal is OrganizationBillingPrincipal {
  if (!operation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new ForbiddenOperationError(
      'PRINCIPAL_KIND_NOT_PERMITTED',
      `Principal kind ${principal.kind} cannot perform operation ${operation.id}`
    )
  }
}

/**
 * Authorizes the organization payer read once and carries the canonical role into
 * presentation. Billing settings require current administrator authority, including
 * plan and seat reads that do not load usage analytics.
 */
export function defineAuthorizedOrganizationBillingUseCase<
  const O extends OrganizationBillingOperation,
  I,
  R,
>(definition: AuthorizedOrganizationBillingDefinition<O, I, R>): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    async execute({ principal, input }) {
      requireBillingSettingsPrincipal(principal, definition.operation)
      const organizationId = definition.organizationId(input)
      const actorUserId = await organizationBillingSettingsActor(
        principal,
        definition.operation,
        organizationId
      )
      const [membership] = await db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, actorUserId)))
        .limit(1)

      if (!membership) {
        throw new ForbiddenOperationError(
          'ORGANIZATION_MEMBERSHIP_REQUIRED',
          'Organization membership is required to read billing information'
        )
      }
      if (membership.role !== 'admin' && membership.role !== 'owner') {
        throw new ForbiddenOperationError(
          'ORGANIZATION_ADMIN_REQUIRED',
          'Organization admin or owner authority is required to read billing information'
        )
      }

      return definition.execute({
        principal,
        input,
        context: {
          organizationId,
          actorUserId,
          userRole: membership.role,
        },
      })
    },
  }
}
