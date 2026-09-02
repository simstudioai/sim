import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type {
  OrganizationBillingSummaryOperation,
  OrganizationBillingSummaryPrincipal,
} from '@/lib/billing/application/organization-billing-summary/operations'
import { ForbiddenOperationError, type OperationUseCase } from '@/lib/core/application'

export interface AuthorizedOrganizationBillingSummaryContext {
  organizationId: string
  actorUserId: string
  userRole: 'admin' | 'owner'
}

interface AuthorizedOrganizationBillingSummaryDefinition<
  O extends OrganizationBillingSummaryOperation,
  I,
  R,
> {
  operation: O
  organizationId(input: I): string
  execute(args: {
    principal: OrganizationBillingSummaryPrincipal
    input: I
    context: AuthorizedOrganizationBillingSummaryContext
  }): Promise<R>
}

function requireSessionPrincipal(
  principal: Principal,
  operation: OrganizationBillingSummaryOperation
): asserts principal is OrganizationBillingSummaryPrincipal {
  if (!operation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new ForbiddenOperationError(
      'PRINCIPAL_KIND_NOT_PERMITTED',
      `Principal kind ${principal.kind} cannot perform operation ${operation.id}`
    )
  }
}

/**
 * Authorizes the organization payer read once and carries the canonical role into
 * presentation. Membership alone is insufficient because the summary includes the
 * organization's pooled spend, payment state, and configurable usage ceiling.
 */
export function defineAuthorizedOrganizationBillingSummaryUseCase<
  const O extends OrganizationBillingSummaryOperation,
  I,
  R,
>(definition: AuthorizedOrganizationBillingSummaryDefinition<O, I, R>): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    async execute({ principal, input }) {
      requireSessionPrincipal(principal, definition.operation)
      const organizationId = definition.organizationId(input)
      const [membership] = await db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, principal.userId)))
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
          actorUserId: principal.userId,
          userRole: membership.role,
        },
      })
    },
  }
}
