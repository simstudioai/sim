import { revokeOrganizationAccountEnrollmentContract } from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  organizationAccountManagementOperations,
  revokeOrganizationAccountEnrollment,
} from '@/lib/credential-groups/application/organization-account-management'

export const DELETE = defineInternalJsonRoute({
  contract: revokeOrganizationAccountEnrollmentContract,
  auth: internalSessionAuth,
  operation: organizationAccountManagementOperations.revoke,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-connected-accounts' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id, enrollmentId: params.enrollmentId }),
  useCase: revokeOrganizationAccountEnrollment,
  present: ({ credentialGroupEnrollment }) => ({ credentialGroupEnrollment }),
})
