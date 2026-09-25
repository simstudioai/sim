import type { Principal } from '@sim/auth/principal'
import { discoverMcpServerToolsAsExecutor } from '@/lib/internal/mcp/discover-tools'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { MCP_SERVER_DELEGATION_AUDIENCE } from '@/lib/mcp/application/authorization'
import { discoverMcpServerToolsUseCase, getMcpServerUseCase } from '@/lib/mcp/application/use-cases'
import { resolveMcpToolBinding } from '@/lib/mcp/tool-binding'
import type { McpTool, McpToolSchema } from '@/lib/mcp/types'
import { createMcpToolId } from '@/lib/mcp/utils'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import { createCopilotChatPrincipal } from '@/lib/mothership/auth/application-delegation'
import type { ToolSchema } from '@/lib/mothership/chat/payload'
import { assertPermissionsAllowed } from '@/ee/access-control/utils/permission-check'
import type { ToolInput } from '@/executor/handlers/agent/types'

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
    // Not deferred: deferral keeps the 200+ unrequested integration schemas out
    // of the tool array, but an MCP server is explicitly enabled by the user and
    // stays enabled for the chat. Deferring it means every turn after the first
    // needs a load_custom_tool round-trip the model has no listing to prompt it
    // for, and a direct call is rejected as unavailable.
    defer_loading: false,
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

/**
 * Resolves every tool from explicitly tagged MCP servers into request-local,
 * deferred tool schemas. Untagged workspace servers are never inspected.
 */
export async function buildTaggedMcpToolSchemas(
  userId: string,
  workspaceId: string,
  serverIds: string[],
  context?: InternalToolOperationContext
): Promise<ToolSchema[]> {
  const uniqueServerIds = [...new Set(serverIds.filter(Boolean))]
  if (uniqueServerIds.length === 0) return []

  await assertPermissionsAllowed({ userId, workspaceId, toolKind: 'mcp' })
  const discovered = await Promise.all(
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
  return dedupeMcpTools(discovered.flat().map(toMothershipMcpTool))
}

/**
 * Resolves selected MCP tools through authorized discovery, including saved legacy bindings.
 */
export async function buildSelectedMcpToolSchemas(
  userId: string,
  workspaceId: string,
  selections: ToolInput[],
  context?: InternalToolOperationContext
): Promise<ToolSchema[]> {
  const selected = selections.filter(
    (tool) => tool.type === 'mcp' && (tool.usageControl || 'auto') !== 'none'
  )
  if (selected.length === 0) return []

  await assertPermissionsAllowed({ userId, workspaceId, toolKind: 'mcp' })
  const discoveredByServer = new Map<string, Promise<McpTool[]>>()
  const resolved = await Promise.all(
    selected.map(async (selection) => {
      const { serverId, toolName } = resolveMcpToolBinding(selection)

      let discovery = discoveredByServer.get(serverId)
      if (!discovery) {
        if (!context)
          throw new Error('MCP workflow tool discovery requires trusted execution scope')
        discovery = discoverMcpServerToolsAsExecutor({ workspaceId, context, serverId })
        discoveredByServer.set(serverId, discovery)
      }
      const match = (await discovery).find((tool) => tool.name === toolName)
      if (!match) throw new Error(`MCP operation "${toolName}" is missing or not permitted`)
      return toMothershipMcpTool(match)
    })
  )

  return dedupeMcpTools(resolved)
}

/** Only explicitly enabled servers contribute schemas; each canonical target is freshly authorized. */
export async function buildOrganizationTaggedMcpToolSchemas(
  principal: Principal,
  owner: { userId: string; organizationId: string; chatId: string },
  serverIds: string[]
): Promise<ToolSchema[]> {
  const targets = new Map<string, string[]>()
  for (const serverId of new Set(serverIds.filter(Boolean))) {
    const { server } = await getMcpServerUseCase.execute({
      principal,
      input: { serverId, organizationId: owner.organizationId },
    })
    if (!server.workspaceId) throw new Error('Tagged MCP server has no workspace target')
    await resolveInvocationWorkspace(owner, server.workspaceId)
    const ids = targets.get(server.workspaceId) ?? []
    ids.push(serverId)
    targets.set(server.workspaceId, ids)
  }
  const tools: ToolSchema[] = []
  for (const [workspaceId, ids] of targets) {
    const schemas = await buildTaggedMcpToolSchemas(owner.userId, workspaceId, ids)
    tools.push(
      ...schemas.map((schema) => ({
        ...schema,
        description: `${schema.description} Workspace target: ${workspaceId}.`,
      }))
    )
  }
  return dedupeMcpTools(tools)
}
