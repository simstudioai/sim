import { getOrganizationRosterContract } from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  readOrganizationRoster,
  readOrganizationRosterOperation,
} from '@/lib/organizations/application/member-roster'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationRosterContract,
  auth: internalSessionAuth,
  operation: readOrganizationRosterOperation,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves the existing session-authenticated organization roster read policy',
  }),
  errorPolicy: {
    project(error) {
      if (error instanceof OrchestrationError && error.code === 'not_found')
        return { status: 403, body: { error: 'Forbidden - Not a member of this organization' } }
      if (error instanceof OrchestrationError && error.code === 'forbidden')
        return { status: 403, body: { error: error.message } }
      return null
    },
    unhandled: () => ({ status: 500, body: { error: 'Failed to fetch organization roster' } }),
  },
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: readOrganizationRoster,
  present: (data) => ({ success: true, data }),
})
