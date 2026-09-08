import {
  configureOrganizationMcpContract,
  getOrganizationDatabricksSetupContract,
} from '@/lib/api/contracts/organization-accounts'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  configureOrganizationMcp,
  configureOrganizationMcpOperation,
} from '@/lib/credential-groups/application/configure-organization-mcp'
import {
  getOrganizationDatabricksSetup,
  getOrganizationDatabricksSetupOperation,
} from '@/lib/credential-groups/application/organization-databricks-setup'

export const GET = defineInternalJsonRoute({
  contract: getOrganizationDatabricksSetupContract,
  auth: internalSessionAuth,
  operation: getOrganizationDatabricksSetupOperation,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-databricks-setup' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params }) => ({ organizationId: params.id }),
  useCase: getOrganizationDatabricksSetup,
  present: ({ server }) => ({ server }),
})

export const PUT = defineInternalJsonRoute({
  contract: configureOrganizationMcpContract,
  auth: internalSessionAuth,
  operation: configureOrganizationMcpOperation,
  rateLimit: internalRateLimits.user({ bucketName: 'organization-databricks-setup' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ organizationId: params.id, ...body }),
  useCase: configureOrganizationMcp,
  present: ({ mcpServer }) => ({ mcpServer }),
})
