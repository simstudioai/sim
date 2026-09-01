import type { Principal } from '@sim/auth/principal'
import type {
  OrganizationUsageOperation,
  OrganizationUsagePrincipal,
} from '@/lib/billing/application/organization-usage/operations'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import {
  type ResolvedUsagePeriod,
  resolveSubscriptionUsagePeriodOrDefault,
} from '@/lib/billing/core/reporting-period'
import { isOrganizationFeatureEntitled } from '@/lib/billing/core/subscription'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import { canUserManageBillingEntity } from '@/lib/billing/core/workspace-billing-authority'
import { ForbiddenOperationError, type OperationUseCase } from '@/lib/core/application'
import { isUsageMonitoringEnabled } from '@/lib/core/config/env-flags'

export interface AuthorizedOrganizationUsageContext {
  organizationId: string
  billingEntity: BillingEntity
  actorUserId: string
  /**
   * Resolved once per request and shared by every query in the use case. Re-resolving
   * per query is how the tiles, the chart, and the event log would come to describe
   * three slightly different windows.
   */
  period: ResolvedUsagePeriod
}

interface AuthorizedOrganizationUsageDefinition<O extends OrganizationUsageOperation, I, R> {
  operation: O
  organizationId(input: I): string
  execute(args: {
    principal: OrganizationUsagePrincipal
    input: I
    context: AuthorizedOrganizationUsageContext
  }): Promise<R>
}

function requireOrganizationUsagePrincipal(
  principal: Principal,
  operation: OrganizationUsageOperation
): asserts principal is OrganizationUsagePrincipal {
  if (!operation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new ForbiddenOperationError(
      'PRINCIPAL_KIND_NOT_PERMITTED',
      `Principal kind ${principal.kind} cannot perform operation ${operation.id}`
    )
  }
}

/**
 * Gate order for every organization usage read. Each step is a distinct refusal so a
 * failure says which rule stopped it.
 *
 * 1. Principal kind — session only.
 * 2. Billing authority — organization admin or owner. A workspace `admin` is
 *    explicitly not sufficient; this is pooled spend across every member.
 * 3. Entitlement — enterprise plan on hosted, `USAGE_MONITORING_ENABLED` on
 *    self-hosted. Reuses audit-logs' error code so the client handles an
 *    entitlement refusal identically across EE settings.
 */
export function defineAuthorizedOrganizationUsageUseCase<
  const O extends OrganizationUsageOperation,
  I,
  R,
>(definition: AuthorizedOrganizationUsageDefinition<O, I, R>): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    async execute({ principal, input }) {
      requireOrganizationUsagePrincipal(principal, definition.operation)
      const actorUserId = principal.userId
      const organizationId = definition.organizationId(input)
      const billingEntity: BillingEntity = { type: 'organization', id: organizationId }

      if (!(await canUserManageBillingEntity(billingEntity, actorUserId))) {
        throw new ForbiddenOperationError(
          'ORGANIZATION_ADMIN_REQUIRED',
          'Organization admin or owner authority is required to read pooled usage'
        )
      }

      /**
       * One call covers both the plan and the deployment: with billing on it checks
       * the enterprise plan; with billing off — a self-hosted deployment, where there
       * is no plan to consult — it answers `USAGE_MONITORING_ENABLED`. That is the
       * same flag the navigation gate reads, so a section can never be visible here
       * and rejected there. Calling `isOrganizationOnEnterprisePlan` directly would
       * answer `true` for every self-hosted organization.
       */
      if (!(await isOrganizationFeatureEntitled(organizationId, isUsageMonitoringEnabled))) {
        throw new ForbiddenOperationError(
          'ENTERPRISE_PLAN_REQUIRED',
          'Active enterprise subscription required'
        )
      }

      const subscription = await getOrganizationSubscription(organizationId)
      const period = resolveSubscriptionUsagePeriodOrDefault(subscription ?? {})

      return definition.execute({
        principal,
        input,
        context: { organizationId, billingEntity, actorUserId, period },
      })
    },
  }
}
