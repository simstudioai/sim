import { getMemberRemovalImpactContract } from '@/lib/api/contracts/organization'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalOrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { previewOrganizationMemberRemoval } from '@/lib/organizations/application/members'

/**
 * Identity-bound credentials the target user owns in this organization's workspaces. Readable by
 * org admins (removing someone) and by the user themself (leaving).
 */
export const GET = defineInternalJsonRoute({
  contract: getMemberRemovalImpactContract,
  auth: internalSessionAuth,
  operation: previewOrganizationMemberRemoval.operation,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing organization member administration behavior.',
  }),
  errorPolicy: internalOrganizationErrorPolicy,
  mapInput: ({ params, query }) => ({ organizationId: params.id, userId: query.userId }),
  useCase: previewOrganizationMemberRemoval,
  present: ({ credentials }) => ({ credentials }),
})
