import { removeOrganizationAccountMcpProviderContract } from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  organizationAccountManagementOperations,
  removeOrganizationAccountMcpProvider,
} from '@/lib/credential-groups/application/organization-account-management'

export const DELETE = defineInternalJsonRoute({
  contract: removeOrganizationAccountMcpProviderContract,
  auth: internalSessionAuth,
  operation: organizationAccountManagementOperations.removeMcp,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-connected-accounts' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id, connectorId: params.connectorId }),
  useCase: removeOrganizationAccountMcpProvider,
  present: () => ({ success: true as const }),
})
