import { MANAGED_MCP_DELEGATION_AUDIENCE } from '@/lib/credentials/application/authorization'
import { discoverManagedMcpToolsUseCase } from '@/lib/credentials/application/discover-managed-mcp-tools'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { MCP_SERVER_DELEGATION_AUDIENCE } from '@/lib/mcp/application/authorization'
import { discoverMcpServerToolsUseCase } from '@/lib/mcp/application/use-cases'
import { isManagedMcpConnectionId, MANAGED_MCP_CONNECTION_PREFIX } from '@/lib/mcp/utils'

export interface DiscoverMcpServerToolsAsExecutorInput {
  workspaceId: string
  context: InternalToolOperationContext
  serverId: string
  signal?: AbortSignal
}

export async function discoverMcpServerToolsAsExecutor({
  workspaceId,
  context,
  serverId,
  signal,
}: DiscoverMcpServerToolsAsExecutorInput) {
  signal?.throwIfAborted()
  if (serverId.startsWith(MANAGED_MCP_CONNECTION_PREFIX)) {
    if (!isManagedMcpConnectionId(serverId)) {
      throw new Error('Invalid managed MCP connection ID')
    }
    const principal = await createExecutorPrincipalFromExecutionContext({
      context,
      audience: MANAGED_MCP_DELEGATION_AUDIENCE,
      resourceScope: { credentialId: serverId },
    })
    signal?.throwIfAborted()
    const result = await discoverManagedMcpToolsUseCase.execute({
      principal,
      input: { workspaceId, credentialId: serverId, signal },
    })
    signal?.throwIfAborted()
    return result.tools
  }

  const principal = await createExecutorPrincipalFromExecutionContext({
    context,
    audience: MCP_SERVER_DELEGATION_AUDIENCE,
    resourceScope: { mcpServerId: serverId },
  })

  signal?.throwIfAborted()
  const result = await discoverMcpServerToolsUseCase.execute({
    principal,
    input: { workspaceId, serverId, signal, requireComplete: true },
  })
  signal?.throwIfAborted()
  return result.tools
}
