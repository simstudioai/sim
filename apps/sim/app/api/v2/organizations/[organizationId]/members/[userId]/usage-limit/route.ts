import {
  v2GetOrganizationMemberUsageLimitContract,
  v2UpdateOrganizationMemberUsageLimitContract,
} from '@/lib/api/contracts/v2/organization-usage'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { memberUsageLimitOperations } from '@/lib/billing/application/member-usage-limits/operations'
import {
  getOrganizationMemberUsageLimit,
  requireHostedMemberUsageLimits,
  updateOrganizationMemberUsageLimit,
} from '@/lib/billing/application/member-usage-limits/use-cases'

export const GET = defineV2JsonRoute({
  contract: v2GetOrganizationMemberUsageLimitContract,
  operation: memberUsageLimitOperations.read,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  beforeParse: requireHostedMemberUsageLimits,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: getOrganizationMemberUsageLimit,
  present: (data) => ({ data }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateOrganizationMemberUsageLimitContract,
  operation: memberUsageLimitOperations.update,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  beforeParse: requireHostedMemberUsageLimits,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: updateOrganizationMemberUsageLimit,
  present: (data) => ({ data }),
})
