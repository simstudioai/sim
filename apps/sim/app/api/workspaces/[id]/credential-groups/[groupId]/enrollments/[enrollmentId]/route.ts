import { deleteCredentialGroupEnrollmentContract } from '@/lib/api/contracts/credential-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { deleteCredentialGroupEnrollmentSettings } from '@/lib/credential-groups/application/manage-enrollments'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

export const DELETE = defineInternalJsonRoute({
  contract: deleteCredentialGroupEnrollmentContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.deleteEnrollment,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal Credential Group deletion behavior',
  }),
  errorPolicy: createCredentialGroupInternalErrorPolicy(
    'Failed to delete person from credential group'
  ),
  mapInput: ({ params }) => ({
    assertedWorkspaceId: params.id,
    credentialGroupId: params.groupId,
    enrollmentId: params.enrollmentId,
  }),
  useCase: deleteCredentialGroupEnrollmentSettings,
})
