import { getOrganizationUsageBreakdownContract } from '@/lib/api/contracts/organization-usage'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getOrganizationUsageBreakdown } from '@/lib/billing/application/organization-usage/get-organization-usage-breakdown'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import { organizationUsageErrorPolicy } from '@/app/api/organizations/[id]/usage/error-policy'

export const dynamic = 'force-dynamic'

/**
 * One route for all five dimensions: they share a scope, a window, a row shape, and
 * authorization, so five routes would be five copies of the same mapping. Separate
 * from the summary because three of the five heap-scan the ledger.
 */
export const GET = defineInternalJsonRoute({
  contract: getOrganizationUsageBreakdownContract,
  auth: internalSessionAuth,
  operation: organizationUsageOperations.readBreakdown,
  rateLimit: internalRateLimits.none({
    reason:
      'Authenticated org-admin settings read, gated on enterprise entitlement and billing authority',
  }),
  errorPolicy: organizationUsageErrorPolicy,
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    dimension: query.dimension,
    workspaceId: query.workspaceId,
    preset: query.preset,
    startDate: query.startDate ? new Date(query.startDate) : undefined,
    endDate: query.endDate ? new Date(query.endDate) : undefined,
    limit: query.limit,
  }),
  useCase: getOrganizationUsageBreakdown,
  present: (result) => result,
})
