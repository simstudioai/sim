import { getOrganizationHomeCalendarContract } from '@/lib/api/contracts/organization-home'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  organizationHomeOperations,
  readOrganizationHomeCalendar,
} from '@/lib/organizations/application/home-widgets'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationHomeCalendarContract,
  auth: internalSessionAuth,
  operation: organizationHomeOperations.readCalendar,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-home-calendar' }),
  errorPolicy: createCredentialGroupInternalErrorPolicy(
    'Failed to load calendar',
    'Organization not found'
  ),
  mapInput: ({ params, query }) => ({ organizationId: params.id, ...query }),
  useCase: readOrganizationHomeCalendar,
  staticResponseHeaders: { 'Cache-Control': 'private, no-store' },
})
