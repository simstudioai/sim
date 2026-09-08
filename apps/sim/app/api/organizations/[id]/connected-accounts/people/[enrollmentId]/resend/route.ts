import { resendOrganizationAccountInvitationContract } from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  organizationAccountManagementOperations,
  resendOrganizationAccountInvitation,
} from '@/lib/credential-groups/application/organization-account-management'

export const POST = defineInternalJsonRoute({
  contract: resendOrganizationAccountInvitationContract,
  auth: internalSessionAuth,
  operation: organizationAccountManagementOperations.resend,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-connected-accounts' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id, enrollmentId: params.enrollmentId }),
  useCase: resendOrganizationAccountInvitation,
  present: ({ credentialGroupEnrollment }) => ({ credentialGroupEnrollment }),
})
