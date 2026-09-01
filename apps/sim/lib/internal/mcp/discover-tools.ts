import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
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
  })

  signal?.throwIfAborted()
  const result = await discoverMcpServerToolsUseCase.execute({
    principal,
    input: { workspaceId, serverId },
  })
  signal?.throwIfAborted()
  return result.tools
}
