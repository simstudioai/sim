import { createOrganizationAccountInvitationLinkContract } from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  createOrganizationAccountInvitationLink,
  organizationAccountManagementOperations,
} from '@/lib/credential-groups/application/organization-account-management'

export const POST = defineInternalJsonRoute({
  contract: createOrganizationAccountInvitationLinkContract,
  auth: internalSessionAuth,
  operation: organizationAccountManagementOperations.invitationLink,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-connected-accounts' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  useCase: createOrganizationAccountInvitationLink,
  present: ({ enrollment, invitationLink }) => ({ enrollment, invitationLink }),
})
