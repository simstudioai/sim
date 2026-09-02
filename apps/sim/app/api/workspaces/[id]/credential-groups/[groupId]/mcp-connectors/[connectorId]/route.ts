import {
  deleteCredentialGroupMcpConnectorContract,
  updateCredentialGroupMcpConnectorContract,
} from '@/lib/api/contracts/credential-groups'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  deleteCredentialGroupMcpConnector,
  updateCredentialGroupMcpConnector,
} from '@/lib/credential-groups/application/manage-mcp-connectors'
import { credentialGroupOperations } from '@/lib/credential-groups/application/operations'
import { createCredentialGroupInternalErrorPolicy } from '@/app/api/workspaces/[id]/credential-groups/error-policy'

const rateLimit = internalRateLimits.none({
  reason: 'Preserve existing internal Credential Group settings behavior',
})

export const PATCH = defineInternalJsonRoute({
  contract: updateCredentialGroupMcpConnectorContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.updateMcpConnector,
  rateLimit,
  errorPolicy: createCredentialGroupInternalErrorPolicy('Failed to update managed MCP connector'),
  mapInput: ({ params, body }) => ({
    assertedWorkspaceId: params.id,
    credentialGroupId: params.groupId,
    connectorId: params.connectorId,
    update: body,
  }),
  useCase: updateCredentialGroupMcpConnector,
  present: ({ mcpServer }) => ({ mcpServer }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteCredentialGroupMcpConnectorContract,
  auth: internalSessionAuth,
  operation: credentialGroupOperations.deleteMcpConnector,
  rateLimit,
  errorPolicy: createCredentialGroupInternalErrorPolicy('Failed to remove managed MCP connector'),
  mapInput: ({ params }) => ({
    assertedWorkspaceId: params.id,
    credentialGroupId: params.groupId,
    connectorId: params.connectorId,
  }),
  useCase: deleteCredentialGroupMcpConnector,
  present: () => ({ success: true as const }),
})
