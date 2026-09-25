import { revokeOrganizationSessionsContract } from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { revokeOrganizationSessions } from '@/lib/organizations/application/revoke-sessions'

export const POST = defineInternalJsonRoute({
  contract: revokeOrganizationSessionsContract,
  operation: revokeOrganizationSessions.operation,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves existing organization session management policy',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: revokeOrganizationSessions,
  present: ({ revokedSessions }) => ({ success: true, data: { revokedSessions } }),
})
