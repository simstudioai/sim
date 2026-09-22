import { v2ListOrganizationUsageEventsContract } from '@/lib/api/contracts/v2/organization-usage'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationUsageErrorPolicy } from '@/lib/api/server/routes/organization-usage'
import { PUBLIC_ORGANIZATION_USAGE_MAX_WINDOW_DAYS } from '@/lib/billing/application/organization-usage/limits'
import { listOrganizationUsageEvents } from '@/lib/billing/application/organization-usage/list-organization-usage-events'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import { toBillingUsageLogSource, toInternalUsageLogSources } from '@/lib/billing/usage-sources'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const GET = defineV2JsonRoute({
  contract: v2ListOrganizationUsageEventsContract,
  operation: organizationUsageOperations.listEvents,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationUsageErrorPolicy,
  mapInput: ({ params, query }) => ({
    ...params,
    preset: query.preset,
    startDate: query.startDate ? new Date(query.startDate) : undefined,
    endDate: query.endDate ? new Date(query.endDate) : undefined,
    timezone: query.timezone,
    source: query.source ? toInternalUsageLogSources(query.source) : undefined,
    limit: query.limit,
    maxWindowDays: PUBLIC_ORGANIZATION_USAGE_MAX_WINDOW_DAYS,
    keyset: {
      sortOrder: query.sortOrder,
      cursorKeys: readSortedCursor(
        query.cursor,
        query.sortBy,
        query.sortOrder,
        cursorScopeKey(cursorRoute(v2ListOrganizationUsageEventsContract, params), {
          preset: query.preset,
          startDate: query.startDate,
          endDate: query.endDate,
          timezone: query.timezone,
          source: query.source,
        })
      ),
    },
  }),
  useCase: listOrganizationUsageEvents,
  present: ({ events, nextCursorKeys }, { params, query }) => ({
    data: events.map((event) => ({ ...event, source: toBillingUsageLogSource(event.source) })),
    nextCursor: writeSortedCursor(
      nextCursorKeys ?? null,
      query.sortBy,
      query.sortOrder,
      cursorScopeKey(cursorRoute(v2ListOrganizationUsageEventsContract, params), {
        preset: query.preset,
        startDate: query.startDate,
        endDate: query.endDate,
        timezone: query.timezone,
        source: query.source,
      })
    ),
  }),
})
