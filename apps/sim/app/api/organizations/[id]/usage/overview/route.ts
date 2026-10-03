import { getOrganizationUsageOverviewContract } from '@/lib/api/contracts/organization-usage'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getOrganizationUsageOverview } from '@/lib/billing/application/organization-usage/get-organization-usage-overview'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import { organizationUsageErrorPolicy } from '@/app/api/organizations/[id]/usage/error-policy'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationUsageOverviewContract,
  auth: internalSessionAuth,
  operation: organizationUsageOperations.readOverview,
  rateLimit: internalRateLimits.none({
    reason:
      'Authenticated org-admin settings read, gated on enterprise entitlement and billing authority',
  }),
  errorPolicy: organizationUsageErrorPolicy,
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    workspaceId: query.workspaceId,
    preset: query.preset,
    startDate: query.startDate ? new Date(query.startDate) : undefined,
    endDate: query.endDate ? new Date(query.endDate) : undefined,
    timezone: query.timezone,
  }),
  useCase: getOrganizationUsageOverview,
  present: (result) => result,
})
