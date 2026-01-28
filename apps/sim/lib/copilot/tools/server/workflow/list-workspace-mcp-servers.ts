import { db } from '@sim/db'
import { workflowMcpServer, workflowMcpTool } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'

const logger = createLogger('ListWorkspaceMcpServersServerTool')

export const ListWorkspaceMcpServersInput = z.object({
  workspaceId: z.string(),
})

export const ListWorkspaceMcpServersResult = z.object({
  servers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      toolCount: z.number(),
      toolNames: z.array(z.string()),
    })
  ),
  count: z.number(),
  message: z.string(),
})

export type ListWorkspaceMcpServersInputType = z.infer<typeof ListWorkspaceMcpServersInput>
export type ListWorkspaceMcpServersResultType = z.infer<typeof ListWorkspaceMcpServersResult>

export const listWorkspaceMcpServersServerTool: BaseServerTool<
  ListWorkspaceMcpServersInputType,
  ListWorkspaceMcpServersResultType
> = {
  name: 'list_workspace_mcp_servers',
  async execute(args: unknown, _context?: { userId: string }) {
    const parsed = ListWorkspaceMcpServersInput.parse(args)
    const { workspaceId } = parsed

    logger.debug('Listing workspace MCP servers', { workspaceId })

    // Get all MCP servers in the workspace with their tool counts
    const servers = await db
      .select({
        id: workflowMcpServer.id,
        name: workflowMcpServer.name,
        description: workflowMcpServer.description,
      })
      .from(workflowMcpServer)
      .where(eq(workflowMcpServer.workspaceId, workspaceId))

    // Get tool names for each server
    const serversWithTools = await Promise.all(
      servers.map(async (server) => {
        const tools = await db
          .select({ toolName: workflowMcpTool.toolName })
          .from(workflowMcpTool)
          .where(eq(workflowMcpTool.serverId, server.id))

        return {
          id: server.id,
          name: server.name,
          description: server.description,
          toolCount: tools.length,
          toolNames: tools.map((t) => t.toolName),
        }
      })
    )

    const message =
      serversWithTools.length === 0
        ? 'No MCP servers found in this workspace. Use create_workspace_mcp_server to create one.'
        : `Found ${serversWithTools.length} MCP server(s) in the workspace.`

    logger.info('Listed MCP servers', { workspaceId, count: serversWithTools.length })

    return ListWorkspaceMcpServersResult.parse({
      servers: serversWithTools,
      count: serversWithTools.length,
      message,
    })
  },
}
