import { v2GetOrganizationUsageSummaryContract } from '@/lib/api/contracts/v2/organization-usage'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationUsageErrorPolicy } from '@/lib/api/server/routes/organization-usage'
import { getOrganizationUsageSummary } from '@/lib/billing/application/organization-usage/get-organization-usage-summary'
import { PUBLIC_ORGANIZATION_USAGE_MAX_WINDOW_DAYS } from '@/lib/billing/application/organization-usage/limits'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import { zonedWallClockToUtc } from '@/lib/core/utils/timezone'

export const GET = defineV2JsonRoute({
  contract: v2GetOrganizationUsageSummaryContract,
  operation: organizationUsageOperations.readSummary,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationUsageErrorPolicy,
  mapInput: ({ params, query }) => ({
    ...params,
    ...query,
    startDate: query.startDate ? new Date(query.startDate) : undefined,
    endDate: query.endDate ? new Date(query.endDate) : undefined,
    maxWindowDays: PUBLIC_ORGANIZATION_USAGE_MAX_WINDOW_DAYS,
  }),
  useCase: getOrganizationUsageSummary,
  present: (data, { query }) => ({
    data: {
      ...data,
      series: data.series.map((point) => ({
        ...point,
        timestamp: zonedWallClockToUtc(point.timestamp, query.timezone).toISOString(),
      })),
    },
  }),
})
