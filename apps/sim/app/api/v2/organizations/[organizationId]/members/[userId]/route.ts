import {
  v2RemoveOrganizationMemberContract,
  v2UpdateOrganizationMemberContract,
} from '@/lib/api/contracts/v2/organizations'
import { presentOrganizationMember } from '@/lib/api/server/organization-presenters'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import {
  removeOrganizationMember,
  updateOrganizationMember,
} from '@/lib/organizations/application/members'
import { organizationOperations } from '@/lib/organizations/application/operations'

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateOrganizationMemberContract,
  operation: organizationOperations.updateMember,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: updateOrganizationMember,
  present: ({ member }) => ({ data: presentOrganizationMember(member) }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2RemoveOrganizationMemberContract,
  operation: organizationOperations.removeMember,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: removeOrganizationMember,
  present: ({ target }) => ({ data: { userId: target.userId, deleted: true as const } }),
})
