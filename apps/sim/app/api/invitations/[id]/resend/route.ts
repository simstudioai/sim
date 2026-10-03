import { resendInvitationContract } from '@/lib/api/contracts/invitations'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalOrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import { resendInvitation } from '@/lib/invitations/application/mutations'
import { invitationOperations } from '@/lib/invitations/application/operations'

export const POST = defineInternalJsonRoute({
  contract: resendInvitationContract,
  auth: internalSessionAuth,
  operation: invitationOperations.resend,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing invitation management admission',
  }),
  errorPolicy: internalOrganizationErrorPolicy,
  mapInput: ({ params }) => ({ invitationId: params.id }),
  useCase: resendInvitation,
  present: () => ({ success: true }),
})
