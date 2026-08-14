import { resendCredentialGroupEnrollmentContract } from '@/lib/api/contracts/credential-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { resendCredentialGroupEnrollmentSettings } from '@/lib/credential-groups/application/manage-enrollments'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { enforceCredentialGroupInvitationRouteRateLimit } from '@/lib/credential-groups/rate-limit'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

export const POST = defineInternalJsonRoute({
  contract: resendCredentialGroupEnrollmentContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.resendEnrollment,
  rateLimit: internalRateLimits.none({
    reason: 'Credential Group invitation resends use a shared per-workspace delivery budget',
  }),
  errorPolicy: createCredentialGroupInternalErrorPolicy(
    'Failed to resend credential group enrollment'
  ),
  async mapInput({ params }) {
    await enforceCredentialGroupInvitationRouteRateLimit(params.id)
    return {
      assertedWorkspaceId: params.id,
      credentialGroupId: params.groupId,
      enrollmentId: params.enrollmentId,
    }
  },
  useCase: resendCredentialGroupEnrollmentSettings,
})
