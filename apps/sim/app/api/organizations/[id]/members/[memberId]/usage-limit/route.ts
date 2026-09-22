import {
  getOrganizationMemberUsageLimitContract,
  updateOrganizationMemberUsageLimitContract,
} from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalMemberUsageLimitErrorPolicy } from '@/lib/api/server/routes/member-usage-limits'
import { memberUsageLimitOperations } from '@/lib/billing/application/member-usage-limits/operations'
import {
  getOrganizationMemberUsageLimit,
  requireHostedMemberUsageLimits,
  updateOrganizationMemberUsageLimit,
} from '@/lib/billing/application/member-usage-limits/use-cases'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationMemberUsageLimitContract,
  operation: memberUsageLimitOperations.read,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve the existing authenticated organization admin read.',
  }),
  beforeParse: requireHostedMemberUsageLimits,
  errorPolicy: internalMemberUsageLimitErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id, userId: params.memberId }),
  useCase: getOrganizationMemberUsageLimit,
  present: (data) => ({ success: true, data }),
})

export const PUT = defineInternalJsonRoute({
  contract: updateOrganizationMemberUsageLimitContract,
  operation: memberUsageLimitOperations.update,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve the existing authenticated organization admin mutation.',
  }),
  beforeParse: requireHostedMemberUsageLimits,
  errorPolicy: internalMemberUsageLimitErrorPolicy,
  mapInput: ({ params, body }) => ({
    organizationId: params.id,
    userId: params.memberId,
    creditLimit: body.creditLimit,
  }),
  useCase: updateOrganizationMemberUsageLimit,
  present: (data) => ({ success: true, message: 'Member credit limit updated successfully', data }),
})
