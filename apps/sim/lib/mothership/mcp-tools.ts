import { toError } from '@sim/utils/errors'
import { withinDeadline } from '@/lib/core/utils/deadline'
import { discoverMcpServerToolsAsExecutor } from '@/lib/internal/mcp/discover-tools'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { MCP_SERVER_DELEGATION_AUDIENCE } from '@/lib/mcp/application/authorization'
import { discoverMcpServerToolsUseCase } from '@/lib/mcp/application/use-cases'
import type { McpToolSchema } from '@/lib/mcp/types'
import { createMcpToolId } from '@/lib/mcp/utils'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import type { ToolSchema } from '@/lib/mothership/chat/payload'

/**
 * How long one best-effort server may hold up a catalog query. A warm server is
 * a cache read; a cold or slow one is skipped for this query while its
 * discovery keeps running and fills the cache for the next one.
 */
const BEST_EFFORT_DISCOVERY_WAIT_MS = 3_000

interface McpServerDiscoveryFailure {
  serverId: string
  error: Error
}

interface McpDiscovery {
  tools: ToolSchema[]
  /** Servers that could not be discovered in time or listed no permitted operations. */
  failures: McpServerDiscoveryFailure[]
}

interface McpDiscoveryServers {
  /** Servers the request names: listed live and completely, however long that takes. */
  complete: string[]
  /**
   * Chat-only: servers available without being named. Served from the discovery
   * cache when fresh, otherwise skipped after {@link BEST_EFFORT_DISCOVERY_WAIT_MS}.
   * One with no permitted operations contributes nothing and is not a failure.
   */
  bestEffort?: string[]
}

function toMothershipMcpTool(tool: {
  serverId: string
  serverName?: string
  name: string
  description?: string
  inputSchema: McpToolSchema | Record<string, unknown>
}): ToolSchema {
  return {
    name: createMcpToolId(tool.serverId, tool.name),
    description:
      tool.description || `MCP tool ${tool.name} from ${tool.serverName || tool.serverId}`,
    input_schema: tool.inputSchema,
    service: `mcp:${tool.serverId}`,
  }
}

/**
 * Resolves MCP server tools into request-local catalog operations. Each server
 * settles on its own: one that cannot be discovered in time, or a named one
 * that lists no permitted operations, is reported in `failures` without
 * discarding the others. Permission-group gating is the caller's, since only it
 * knows whether the request depends on MCP.
 */
export async function buildMcpToolSchemas(
  userId: string,
  workspaceId: string,
  servers: McpDiscoveryServers,
  context?: InternalToolOperationContext
): Promise<McpDiscovery> {
  const complete = [...new Set(servers.complete.filter(Boolean))]
  const bestEffort = [...new Set(servers.bestEffort ?? [])].filter(
    (serverId) => serverId && !complete.includes(serverId)
  )
  if (context && bestEffort.length)
    throw new Error('Executor MCP discovery is limited to the servers its block selected')
  const serverIds = [...complete, ...bestEffort]
  if (serverIds.length === 0) return { tools: [], failures: [] }

  const principal = () =>
    createCopilotChatPrincipal({ userId, workspaceId }, MCP_SERVER_DELEGATION_AUDIENCE)
  const discoverComplete = async (serverId: string) => {
    const tools = context
      ? await discoverMcpServerToolsAsExecutor({ workspaceId, context, serverId })
      : (
          await discoverMcpServerToolsUseCase.execute({
            principal: principal(),
            input: { workspaceId, serverId, requireComplete: true },
          })
        ).tools
    if (!tools.length) throw new Error(`No permitted MCP operations are available for ${serverId}`)
    return tools
  }
  /** Ignores the deadline's signal so a slow server's discovery still finishes and warms the cache. */
  const discoverBestEffort = async (serverId: string) => {
    const discovery = discoverMcpServerToolsUseCase.execute({
      principal: principal(),
      input: { workspaceId, serverId },
    })
    const { tools } = await withinDeadline(
      () => discovery,
      Date.now() + BEST_EFFORT_DISCOVERY_WAIT_MS
    )
    return tools
  }

  const outcomes = await Promise.allSettled([
    ...complete.map(discoverComplete),
    ...bestEffort.map(discoverBestEffort),
  ])

  const seen = new Set<string>()
  const discovery: McpDiscovery = { tools: [], failures: [] }
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      discovery.failures.push({ serverId: serverIds[index], error: toError(outcome.reason) })
      return
    }
    for (const tool of outcome.value.map(toMothershipMcpTool)) {
      if (seen.has(tool.name)) continue
      seen.add(tool.name)
      discovery.tools.push(tool)
    }
  })
  return discovery
}
