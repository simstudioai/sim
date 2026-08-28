import { getOrganizationUsageSummaryContract } from '@/lib/api/contracts/organization-usage'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getOrganizationUsageSummary } from '@/lib/billing/application/organization-usage/get-organization-usage-summary'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import { organizationUsageErrorPolicy } from '@/app/api/organizations/[id]/usage/error-policy'

export const dynamic = 'force-dynamic'

/**
 * Everything above the fold in one round trip. Kept separate from the breakdown
 * route because every read here is index-covered, and folding in a dimension that
 * heap-scans would put that cost on first paint.
 */
export const GET = defineInternalJsonRoute({
  contract: getOrganizationUsageSummaryContract,
  auth: internalSessionAuth,
  operation: organizationUsageOperations.readSummary,
  rateLimit: internalRateLimits.none({
    reason:
      'Authenticated org-admin settings read, gated on enterprise entitlement and billing authority',
  }),
  errorPolicy: organizationUsageErrorPolicy,
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    preset: query.preset,
    startDate: query.startDate ? new Date(query.startDate) : undefined,
    endDate: query.endDate ? new Date(query.endDate) : undefined,
    timezone: query.timezone,
  }),
  useCase: getOrganizationUsageSummary,
  present: (result) => result,
})
