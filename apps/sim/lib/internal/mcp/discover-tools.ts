import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { MCP_SERVER_DELEGATION_AUDIENCE } from '@/lib/mcp/application/authorization'
import { discoverMcpServerToolsUseCase } from '@/lib/mcp/application/use-cases'

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
  const principal = await createExecutorPrincipalFromExecutionContext({
    context,
    audience: MCP_SERVER_DELEGATION_AUDIENCE,
  })

  signal?.throwIfAborted()
  const result = await discoverMcpServerToolsUseCase.execute({
    principal,
    // See `executionActorUserId`: preserves the pre-in-process behavior for unattended runs.
    input: { workspaceId, serverId, executionActorUserId: context.userId },
  })
  signal?.throwIfAborted()
  return result.tools
}
