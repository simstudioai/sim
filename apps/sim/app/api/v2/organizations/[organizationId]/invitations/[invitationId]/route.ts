import {
  v2GetOrganizationInvitationContract,
  v2RevokeOrganizationInvitationContract,
} from '@/lib/api/contracts/v2/organizations'
import { presentOrganizationInvitation } from '@/lib/api/server/organization-presenters'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { revokeInvitation } from '@/lib/invitations/application/mutations'
import { invitationOperations } from '@/lib/invitations/application/operations'
import { organizationOperations } from '@/lib/organizations/application/operations'
import { getOrganizationInvitation } from '@/lib/organizations/application/reads'

export const GET = defineV2JsonRoute({
  contract: v2GetOrganizationInvitationContract,
  operation: organizationOperations.readInvitation,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params }) => params,
  useCase: getOrganizationInvitation,
  present: (invitation) => ({ data: presentOrganizationInvitation(invitation) }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2RevokeOrganizationInvitationContract,
  operation: invitationOperations.revoke,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params }) => ({
    invitationId: params.invitationId,
    assertedOrganizationId: params.organizationId,
  }),
  useCase: revokeInvitation,
  present: (invitation) => ({
    data: { id: invitation.invitation.id, status: 'cancelled' as const },
  }),
})
