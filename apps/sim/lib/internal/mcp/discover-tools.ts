import { createExecutorPrincipal } from '@/lib/internal/principals/executor'
import { MCP_SERVER_DELEGATION_AUDIENCE } from '@/lib/mcp/application/authorization'
import { discoverMcpServerToolsUseCase } from '@/lib/mcp/application/use-cases'

export interface DiscoverMcpServerToolsAsExecutorInput {
  userId: string
  workspaceId: string
  workflowId: string
  executionId?: string
  serverId: string
  signal?: AbortSignal
}

export async function discoverMcpServerToolsAsExecutor({
  userId,
  workspaceId,
  workflowId,
  executionId,
  serverId,
  signal,
}: DiscoverMcpServerToolsAsExecutorInput) {
  signal?.throwIfAborted()
  const principal = await createExecutorPrincipal({
    userId,
    workflowId,
    ...(executionId ? { executionId } : {}),
    audience: MCP_SERVER_DELEGATION_AUDIENCE,
  })

  signal?.throwIfAborted()
  const result = await discoverMcpServerToolsUseCase.execute({
    principal,
    input: { workspaceId, serverId },
  })
  signal?.throwIfAborted()
  return result.tools
}
