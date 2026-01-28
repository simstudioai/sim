import { db } from '@sim/db'
import { workflowMcpServer } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'

const logger = createLogger('CreateWorkspaceMcpServerServerTool')

export const CreateWorkspaceMcpServerInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  workspaceId: z.string().min(1),
})

export const CreateWorkspaceMcpServerResult = z.object({
  success: z.boolean(),
  serverId: z.string().nullable(),
  serverName: z.string().nullable(),
  description: z.string().nullable(),
  message: z.string(),
})

export type CreateWorkspaceMcpServerInputType = z.infer<typeof CreateWorkspaceMcpServerInput>
export type CreateWorkspaceMcpServerResultType = z.infer<typeof CreateWorkspaceMcpServerResult>

export const createWorkspaceMcpServerServerTool: BaseServerTool<
  CreateWorkspaceMcpServerInputType,
  CreateWorkspaceMcpServerResultType
> = {
  name: 'create_workspace_mcp_server',
  async execute(args: unknown, context?: { userId: string }) {
    const parsed = CreateWorkspaceMcpServerInput.parse(args)
    const { name, description, workspaceId } = parsed

    if (!context?.userId) {
      throw new Error('User authentication required')
    }

    logger.debug('Creating workspace MCP server', { name, workspaceId })

    // Check if server with same name already exists
    const existing = await db
      .select({ id: workflowMcpServer.id })
      .from(workflowMcpServer)
      .where(eq(workflowMcpServer.workspaceId, workspaceId))
      .limit(100)

    // Generate unique ID
    const serverId = crypto.randomUUID()
    const now = new Date()

    await db.insert(workflowMcpServer).values({
      id: serverId,
      workspaceId,
      createdBy: context.userId,
      name: name.trim(),
      description: description?.trim() || null,
      createdAt: now,
      updatedAt: now,
    })

    logger.info('Created MCP server', { serverId, name })

    return CreateWorkspaceMcpServerResult.parse({
      success: true,
      serverId,
      serverName: name.trim(),
      description: description?.trim() || null,
      message: `MCP server "${name}" created successfully. You can now deploy workflows to it using deploy_mcp.`,
    })
  },
}
