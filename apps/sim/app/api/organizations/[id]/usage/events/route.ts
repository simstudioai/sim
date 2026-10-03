import { listOrganizationUsageEventsContract } from '@/lib/api/contracts/organization-usage'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listOrganizationUsageEvents } from '@/lib/billing/application/organization-usage/list-organization-usage-events'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import { organizationUsageErrorPolicy } from '@/app/api/organizations/[id]/usage/error-policy'

export const dynamic = 'force-dynamic'

/**
 * The raw ledger, paged. Separate from the summary because it owns a cursor
 * lifecycle and its own staleness — folding it in would re-run the headline
 * aggregate on every scroll.
 */
export const GET = defineInternalJsonRoute({
  contract: listOrganizationUsageEventsContract,
  auth: internalSessionAuth,
  operation: organizationUsageOperations.listEvents,
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
    source: query.source,
    limit: query.limit,
    cursor: query.cursor,
  }),
  useCase: listOrganizationUsageEvents,
  present: (result) => result,
})
