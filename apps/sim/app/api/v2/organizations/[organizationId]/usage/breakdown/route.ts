import { v2GetOrganizationUsageBreakdownContract } from '@/lib/api/contracts/v2/organization-usage'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationUsageErrorPolicy } from '@/lib/api/server/routes/organization-usage'
import { getOrganizationUsageBreakdown } from '@/lib/billing/application/organization-usage/get-organization-usage-breakdown'
import {
  PUBLIC_ORGANIZATION_USAGE_MAX_GROUPED_ROWS,
  PUBLIC_ORGANIZATION_USAGE_MAX_WINDOW_DAYS,
} from '@/lib/billing/application/organization-usage/limits'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'

export const GET = defineV2JsonRoute({
  contract: v2GetOrganizationUsageBreakdownContract,
  operation: organizationUsageOperations.readBreakdown,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationUsageErrorPolicy,
  mapInput: ({ params, query }) => ({
    ...params,
    ...query,
    startDate: query.startDate ? new Date(query.startDate) : undefined,
    endDate: query.endDate ? new Date(query.endDate) : undefined,
    maxWindowDays: PUBLIC_ORGANIZATION_USAGE_MAX_WINDOW_DAYS,
    maxGroupedRows: PUBLIC_ORGANIZATION_USAGE_MAX_GROUPED_ROWS,
  }),
  useCase: getOrganizationUsageBreakdown,
  present: (data) => ({ data }),
})
