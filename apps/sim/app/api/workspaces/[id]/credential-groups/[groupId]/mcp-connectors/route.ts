import { createCredentialGroupMcpConnectorContract } from '@/lib/api/contracts/credential-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { createCredentialGroupMcpConnector } from '@/lib/credential-groups/application/manage-mcp-connectors'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

export const POST = defineInternalJsonRoute({
  contract: createCredentialGroupMcpConnectorContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.createMcpConnector,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal Credential Group settings behavior',
  }),
  errorPolicy: createCredentialGroupInternalErrorPolicy('Failed to add managed MCP connector'),
  mapInput: ({ params, body }) => ({
    assertedWorkspaceId: params.id,
    credentialGroupId: params.groupId,
    connector: body,
  }),
  useCase: createCredentialGroupMcpConnector,
  present: ({ mcpServer }) => ({ mcpServer }),
})
