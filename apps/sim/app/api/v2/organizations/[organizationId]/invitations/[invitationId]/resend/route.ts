import { v2ResendOrganizationInvitationContract } from '@/lib/api/contracts/v2/organizations'
import { presentOrganizationInvitation } from '@/lib/api/server/organization-presenters'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { resendInvitation } from '@/lib/invitations/application/mutations'
import { invitationOperations } from '@/lib/invitations/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2ResendOrganizationInvitationContract,
  operation: invitationOperations.resend,
  auth: v2ApiKeyAuth,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrganizationErrorPolicy,
  mapInput: ({ params }) => ({
    invitationId: params.invitationId,
    assertedOrganizationId: params.organizationId,
  }),
  parseOptions: { optionalJsonBody: true },
  useCase: resendInvitation,
  present: (invitation) => ({ data: presentOrganizationInvitation(invitation) }),
})
