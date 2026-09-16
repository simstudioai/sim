import { getOrganizationActivitySummaryContract } from '@/lib/api/contracts/organization-activity'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getOrganizationActivitySummary } from '@/lib/billing/application/organization-usage/get-organization-activity'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import { organizationUsageErrorPolicy } from '@/app/api/organizations/[id]/usage/error-policy'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationActivitySummaryContract,
  auth: internalSessionAuth,
  operation: organizationUsageOperations.readActivitySummary,
  rateLimit: internalRateLimits.user({
    bucketName: 'organization-activity',
  }),
  errorPolicy: organizationUsageErrorPolicy,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
  mapInput: ({ params, query }) => ({
    ...query,
    organizationId: params.id,
    startDate: query.startDate ? new Date(query.startDate) : undefined,
    endDate: query.endDate ? new Date(query.endDate) : undefined,
  }),
  useCase: getOrganizationActivitySummary,
  present: (result) => result,
})
