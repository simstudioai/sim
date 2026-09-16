import {
  getOrganizationMemberUsageLimitContract,
  updateOrganizationMemberUsageLimitContract,
} from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  memberUsageLimitOperations,
  readMemberUsageLimit,
  requireHostedMemberUsageLimits,
  updateMemberUsageLimit,
} from '@/lib/billing/application/member-usage-limits'

const rateLimit = internalRateLimits.none({
  reason: 'Preserve existing hosted member-cap settings admission',
})
export const GET = defineInternalJsonRoute({
  contract: getOrganizationMemberUsageLimitContract,
  auth: internalSessionAuth,
  operation: memberUsageLimitOperations.read,
  rateLimit,
  errorPolicy: internalOrchestrationErrorPolicy,
  beforeParse: async () => requireHostedMemberUsageLimits(),
  mapInput: ({ params }) => ({ organizationId: params.id, userId: params.memberId }),
  useCase: readMemberUsageLimit,
  present: (data) => ({ success: true, data }),
})
export const PUT = defineInternalJsonRoute({
  contract: updateOrganizationMemberUsageLimitContract,
  auth: internalSessionAuth,
  operation: memberUsageLimitOperations.update,
  rateLimit,
  errorPolicy: internalOrchestrationErrorPolicy,
  beforeParse: async () => requireHostedMemberUsageLimits(),
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    userId: params.memberId,
    creditLimit: body.creditLimit,
  }),
  useCase: updateMemberUsageLimit,
  present: (data) => ({ success: true, message: 'Member credit limit updated successfully', data }),
})
