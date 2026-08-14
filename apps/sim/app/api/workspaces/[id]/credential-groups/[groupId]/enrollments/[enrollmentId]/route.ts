import { revokeCredentialGroupEnrollmentContract } from '@/lib/api/contracts/credential-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { revokeCredentialGroupEnrollmentSettings } from '@/lib/credential-groups/application/manage-enrollments'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

export const DELETE = defineInternalJsonRoute({
  contract: revokeCredentialGroupEnrollmentContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.revokeEnrollment,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal Credential Group revocation behavior',
  }),
  errorPolicy: createCredentialGroupInternalErrorPolicy(
    'Failed to revoke credential group enrollment'
  ),
  mapInput: ({ params }) => ({
    assertedWorkspaceId: params.id,
    credentialGroupId: params.groupId,
    enrollmentId: params.enrollmentId,
  }),
  useCase: revokeCredentialGroupEnrollmentSettings,
})
