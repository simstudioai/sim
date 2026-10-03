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
import { ForbiddenOperationError, type OperationUseCase } from '@/lib/core/application'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
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
  /** The payer's subscription, already loaded to resolve {@link period}. */
  subscription: Awaited<ReturnType<typeof getOrganizationSubscription>>
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
 * Organization-wide usage requires admin or owner authority, current credential policy,
 * and usage-monitoring entitlement. Workspace admin authority alone is insufficient.
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
      const organizationId = definition.organizationId(input)
      const billingEntity: BillingEntity = { type: 'organization', id: organizationId }

      const { userId: actorUserId } = await authorizeOrganizationOperation(
        principal,
        definition.operation,
        { organizationId }
      )

      /**
       * One call covers both the plan and the deployment: with billing on it checks
       * the enterprise plan; with billing off — a self-hosted deployment, where there
       * is no plan to consult — it answers `USAGE_MONITORING_ENABLED`. That is the
       * same flag the navigation gate reads, so a section can never be visible here
       * and rejected there. Calling `isOrganizationOnEnterprisePlan` directly would
       * answer `true` for every self-hosted organization.
       *
       * The subscription is loaded alongside rather than after: nothing is returned
       * before the gate decides, and every usage read pays this round trip first.
       */
      const [entitled, subscription] = await Promise.all([
        isOrganizationFeatureEntitled(organizationId, isUsageMonitoringEnabled),
        getOrganizationSubscription(organizationId),
      ])
      if (!entitled) {
        throw new ForbiddenOperationError(
          'ENTERPRISE_PLAN_REQUIRED',
          'Active enterprise subscription required'
        )
      }

      const period = resolveSubscriptionUsagePeriodOrDefault(subscription ?? {})

      return definition.execute({
        principal,
        input,
        context: { organizationId, billingEntity, actorUserId, period, subscription },
      })
    },
  }
}
