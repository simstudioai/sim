import { deleteCredentialGroupEnrollmentContract } from '@/lib/api/contracts/credential-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { createCredentialGroupInternalErrorPolicy } from '@/lib/api/server/routes/credential-groups'
import { deleteCredentialGroupEnrollmentSettings } from '@/lib/credential-groups/application/manage-enrollments'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'

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
  present: ({ credentialGroupEnrollment }) => ({ credentialGroupEnrollment }),
})
