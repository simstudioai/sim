import { addOrganizationAccountMcpProviderContract } from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  addOrganizationAccountMcpProvider,
  organizationAccountManagementOperations,
} from '@/lib/credential-groups/application/organization-account-management'

export const POST = defineInternalJsonRoute({
  contract: addOrganizationAccountMcpProviderContract,
  auth: internalSessionAuth,
  operation: organizationAccountManagementOperations.addMcp,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-connected-accounts' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  useCase: addOrganizationAccountMcpProvider,
  present: ({ mcpServer }) => ({ mcpServer }),
})
