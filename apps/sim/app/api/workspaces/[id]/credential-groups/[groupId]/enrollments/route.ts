import { inviteCredentialGroupEnrollmentsContract } from '@/lib/api/contracts/credential-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { inviteCredentialGroupEnrollmentsSettings } from '@/lib/credential-groups/application/manage-enrollments'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { enforceCredentialGroupInvitationRouteRateLimit } from '@/lib/credential-groups/rate-limit'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

export const POST = defineInternalJsonRoute({
  contract: inviteCredentialGroupEnrollmentsContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.inviteBatch,
  rateLimit: internalRateLimits.none({
    reason: 'Credential Group invitations use a shared per-workspace delivery budget',
  }),
  errorPolicy: createCredentialGroupInternalErrorPolicy(
    'Failed to invite credential group enrollments'
  ),
  async mapInput({ params, body }) {
    await enforceCredentialGroupInvitationRouteRateLimit(params.id)
    return {
      assertedWorkspaceId: params.id,
      credentialGroupId: params.groupId,
      emails: body.emails,
    }
  },
  useCase: inviteCredentialGroupEnrollmentsSettings,
})
