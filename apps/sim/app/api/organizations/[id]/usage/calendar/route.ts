import { getOrganizationUsageCalendarContract } from '@/lib/api/contracts/organization-usage'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getOrganizationUsageCalendar } from '@/lib/billing/application/organization-usage/get-organization-usage-calendar'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import { organizationUsageErrorPolicy } from '@/app/api/organizations/[id]/usage/error-policy'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationUsageCalendarContract,
  auth: internalSessionAuth,
  operation: organizationUsageOperations.readCalendar,
  rateLimit: internalRateLimits.none({
    reason:
      'Authenticated org-admin settings read, gated on enterprise entitlement and billing authority',
  }),
  errorPolicy: organizationUsageErrorPolicy,
  mapInput: ({ params, query }) => ({
    organizationId: params.id,
    workspaceId: query.workspaceId,
    timezone: query.timezone,
  }),
  useCase: getOrganizationUsageCalendar,
  present: (result) => result,
})
