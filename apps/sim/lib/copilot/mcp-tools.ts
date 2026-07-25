import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { ToolSchema } from '@/lib/copilot/chat/payload'
import type { McpTool, McpToolSchema } from '@/lib/mcp/types'
import { createMcpToolId } from '@/lib/mcp/utils'
import { validateMcpToolsAllowed } from '@/ee/access-control/utils/permission-check'
import type { ToolInput } from '@/executor/handlers/agent/types'

const logger = createLogger('CopilotMcpTools')

function toMothershipMcpTool(tool: {
  serverId: string
  serverName?: string
  name: string
  description?: string
  inputSchema: McpToolSchema | Record<string, unknown>
}): ToolSchema {
  const callableName = createMcpToolId(tool.serverId, tool.name)
  return {
    name: callableName,
    description:
      tool.description || `MCP tool ${tool.name} from ${tool.serverName || tool.serverId}`,
    input_schema: tool.inputSchema,
    defer_loading: true,
    executeLocally: false,
    service: `mcp:${tool.serverId}`,
    params: {
      mothershipToolKind: 'mcp',
      mothershipToolName: callableName,
      mothershipToolTitle: tool.serverName ? `${tool.serverName}: ${tool.name}` : tool.name,
      serverId: tool.serverId,
      toolName: tool.name,
    },
  }
}

function dedupeMcpTools(tools: ToolSchema[]): ToolSchema[] {
  const seen = new Set<string>()
  return tools.filter((tool) => {
    if (seen.has(tool.name)) return false
    seen.add(tool.name)
    return true
  })
}

async function discoverServerTools(
  userId: string,
  workspaceId: string,
  serverId: string
): Promise<McpTool[]> {
  try {
    const { mcpService } = await import('@/lib/mcp/service')
    return await mcpService.discoverServerTools(userId, serverId, workspaceId)
  } catch (error) {
    logger.warn('Failed to resolve tagged MCP server tools', {
      serverId,
      workspaceId,
      error: toError(error).message,
    })
    return []
  }
}

/**
 * Resolves every tool from explicitly tagged MCP servers into request-local,
 * deferred tool schemas. Untagged workspace servers are never inspected.
 */
export async function buildTaggedMcpToolSchemas(
  userId: string,
  workspaceId: string,
  serverIds: string[]
): Promise<ToolSchema[]> {
  const uniqueServerIds = [...new Set(serverIds.filter(Boolean))]
  if (uniqueServerIds.length === 0) return []

  await validateMcpToolsAllowed(userId, workspaceId)
  const discovered = await Promise.all(
    uniqueServerIds.map((serverId) => discoverServerTools(userId, workspaceId, serverId))
  )
  return dedupeMcpTools(discovered.flat().map(toMothershipMcpTool))
}

/**
 * Resolves the individual MCP tools selected on a Mothership block. Cached
 * editor schemas are used directly; legacy selections without a schema fall
 * back to one discovery call per selected server.
 */
export async function buildSelectedMcpToolSchemas(
  userId: string,
  workspaceId: string,
  selections: ToolInput[]
): Promise<ToolSchema[]> {
  const selected = selections.filter(
    (tool) =>
      tool.type === 'mcp' &&
      (tool.usageControl || 'auto') !== 'none' &&
      typeof tool.params?.serverId === 'string' &&
      typeof tool.params?.toolName === 'string'
  )
  if (selected.length === 0) return []

  await validateMcpToolsAllowed(userId, workspaceId)
  const discoveredByServer = new Map<string, Promise<McpTool[]>>()
  const resolved = await Promise.all(
    selected.map(async (selection) => {
      const serverId = selection.params!.serverId as string
      const toolName = selection.params!.toolName as string
      const serverName =
        typeof selection.params!.serverName === 'string'
          ? (selection.params!.serverName as string)
          : undefined

      if (selection.schema && typeof selection.schema === 'object') {
        return toMothershipMcpTool({
          serverId,
          serverName,
          name: toolName,
          description:
            typeof selection.schema.description === 'string'
              ? selection.schema.description
              : undefined,
          inputSchema: selection.schema as Record<string, unknown>,
        })
      }

      let discovery = discoveredByServer.get(serverId)
      if (!discovery) {
        discovery = discoverServerTools(userId, workspaceId, serverId)
        discoveredByServer.set(serverId, discovery)
      }
      const match = (await discovery).find((tool) => tool.name === toolName)
      return match ? toMothershipMcpTool(match) : null
    })
  )

  return dedupeMcpTools(resolved.filter((tool): tool is ToolSchema => tool !== null))
}
