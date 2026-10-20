import { toError } from '@sim/utils/errors'
import { discoverMcpServerToolsAsExecutor } from '@/lib/internal/mcp/discover-tools'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { MCP_SERVER_DELEGATION_AUDIENCE } from '@/lib/mcp/application/authorization'
import { discoverMcpServerToolsUseCase } from '@/lib/mcp/application/use-cases'
import type { McpToolSchema } from '@/lib/mcp/types'
import { createMcpToolId } from '@/lib/mcp/utils'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import type { ToolSchema } from '@/lib/mothership/chat/payload'
import { assertPermissionsAllowed } from '@/ee/access-control/utils/permission-check'

interface TaggedMcpServerFailure {
  serverId: string
  error: Error
}

interface TaggedMcpDiscovery {
  tools: ToolSchema[]
  /** Servers that could not be discovered or listed no permitted operations. */
  failures: TaggedMcpServerFailure[]
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
 * Resolves every tool from explicitly tagged MCP servers into request-local
 * catalog operations. Untagged workspace servers are never inspected. Each
 * server settles on its own: one that cannot be discovered, or lists no
 * permitted operations, is reported in `failures` without discarding the others.
 */
export async function buildTaggedMcpToolSchemas(
  userId: string,
  workspaceId: string,
  serverIds: string[],
  context?: InternalToolOperationContext
): Promise<TaggedMcpDiscovery> {
  const uniqueServerIds = [...new Set(serverIds.filter(Boolean))]
  if (uniqueServerIds.length === 0) return { tools: [], failures: [] }

  await assertPermissionsAllowed({ userId, workspaceId, toolKind: 'mcp' })
  const outcomes = await Promise.allSettled(
    uniqueServerIds.map(async (serverId) => {
      const tools = context
        ? await discoverMcpServerToolsAsExecutor({ workspaceId, context, serverId })
        : (
            await discoverMcpServerToolsUseCase.execute({
              principal: createCopilotChatPrincipal(
                { userId, workspaceId },
                MCP_SERVER_DELEGATION_AUDIENCE
              ),
              input: { workspaceId, serverId, requireComplete: true },
            })
          ).tools
      if (!tools.length)
        throw new Error(`No permitted MCP operations are available for ${serverId}`)
      return tools
    })
  )

  const seen = new Set<string>()
  const discovery: TaggedMcpDiscovery = { tools: [], failures: [] }
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      discovery.failures.push({ serverId: uniqueServerIds[index], error: toError(outcome.reason) })
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
