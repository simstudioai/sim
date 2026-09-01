import { listManagedMcpCatalogContract } from '@/lib/api/contracts/mcp'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { listManagedMcpConnectionsUseCase } from '@/lib/mcp/application/managed-connections'
import { mcpServerOperations } from '@/lib/mcp/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listManagedMcpCatalogContract,
  auth: internalSessionAuth,
  operation: mcpServerOperations.listManagedConnections,
  rateLimit: internalRateLimits.none({ reason: 'Managed MCP metadata is workspace-scoped' }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => ({ workspaceId: query.workspaceId }),
  useCase: listManagedMcpConnectionsUseCase,
  present: (result) => result,
})
