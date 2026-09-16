import { resendInvitationContract } from '@/lib/api/contracts/invitations'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  invitationManagementOperations,
  resendInvitation,
} from '@/lib/invitations/application/manage-invitation'
import { invitationManagementErrorPolicy } from '@/lib/invitations/management-error-policy'

export const POST = defineInternalJsonRoute({
  contract: resendInvitationContract,
  auth: internalSessionAuth,
  operation: invitationManagementOperations.resend,
  rateLimit: internalRateLimits.none({
    reason: 'Preserves the existing authenticated invitation resend policy',
  }),
  errorPolicy: {
    ...invitationManagementErrorPolicy,
    unhandled: () => ({ status: 500, body: { error: 'Failed to resend invitation' } }),
  },
  mapInput: ({ params }) => ({ invitationId: params.id }),
  useCase: resendInvitation,
})
