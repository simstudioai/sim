import {
  inviteOrganizationAccountPeopleContract,
  listOrganizationAccountPeopleContract,
} from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  inviteOrganizationAccountPeople,
  listOrganizationAccountPeople,
  organizationAccountManagementOperations,
} from '@/lib/credential-groups/application/organization-account-management'

export const GET = defineInternalJsonRoute({
  contract: listOrganizationAccountPeopleContract,
  auth: internalSessionAuth,
  operation: organizationAccountManagementOperations.people,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-connected-accounts' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ organizationId: params.id, ...query }),
  useCase: listOrganizationAccountPeople,
})

export const POST = defineInternalJsonRoute({
  contract: inviteOrganizationAccountPeopleContract,
  auth: internalSessionAuth,
  operation: organizationAccountManagementOperations.invite,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-connected-accounts' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  useCase: inviteOrganizationAccountPeople,
  present: ({ results, sentCount, failedCount }) => ({ results, sentCount, failedCount }),
})
