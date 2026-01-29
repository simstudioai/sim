import { db } from '@sim/db'
import { mcpServers, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { BaseServerTool } from '../base-tool'

const logger = createLogger('ManageMcpToolServerTool')

const McpServerConfigZ = z.object({
  name: z.string(),
  transport: z.literal('streamable-http').optional().default('streamable-http'),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  timeout: z.number().optional().default(30000),
  enabled: z.boolean().optional().default(true),
})

export const ManageMcpToolInput = z.object({
  workflowId: z.string().min(1),
  workspaceId: z.string().optional(),
  operation: z.enum(['add', 'edit', 'delete']),
  serverId: z.string().optional(),
  config: McpServerConfigZ.optional(),
})

type ManageMcpToolResult = {
  success: boolean
  operation: string
  serverId?: string
  serverName?: string
}

export const manageMcpToolServerTool: BaseServerTool<
  typeof ManageMcpToolInput,
  ManageMcpToolResult
> = {
  name: 'manage_mcp_tool',

  async execute(args: unknown, context?: { userId: string }) {
    const parsed = ManageMcpToolInput.parse(args)
    const { workflowId, operation, serverId, config } = parsed

    // Get workspace ID from workflow if not provided
    let workspaceId = parsed.workspaceId
    if (!workspaceId) {
      const [wf] = await db
        .select({ workspaceId: workflow.workspaceId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!wf?.workspaceId) {
        throw new Error('Workflow not found or has no workspace')
      }
      workspaceId = wf.workspaceId
    }

    logger.info('Managing MCP tool', {
      operation,
      serverId,
      serverName: config?.name,
      workspaceId,
    })

    switch (operation) {
      case 'add':
        return await addMcpServer(workspaceId, config, context?.userId)
      case 'edit':
        return await editMcpServer(workspaceId, serverId, config)
      case 'delete':
        return await deleteMcpServer(workspaceId, serverId)
      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
  },
}

async function addMcpServer(
  workspaceId: string,
  config: z.infer<typeof McpServerConfigZ> | undefined,
  userId: string | undefined
): Promise<ManageMcpToolResult> {
  if (!config) {
    throw new Error('Config is required for adding an MCP tool')
  }
  if (!config.name) {
    throw new Error('Server name is required')
  }
  if (!config.url) {
    throw new Error('Server URL is required for streamable-http transport')
  }
  if (!userId) {
    throw new Error('User ID is required for adding an MCP tool')
  }

  const [created] = await db
    .insert(mcpServers)
    .values({
      id: nanoid(),
      workspaceId,
      createdBy: userId,
      name: config.name,
      url: config.url,
      transport: config.transport || 'streamable-http',
      headers: config.headers || {},
      timeout: config.timeout || 30000,
      enabled: config.enabled !== false,
    })
    .returning({ id: mcpServers.id })

  logger.info(`Created MCP server: ${config.name}`, { serverId: created.id })

  return {
    success: true,
    operation: 'add',
    serverId: created.id,
    serverName: config.name,
  }
}

async function editMcpServer(
  workspaceId: string,
  serverId: string | undefined,
  config: z.infer<typeof McpServerConfigZ> | undefined
): Promise<ManageMcpToolResult> {
  if (!serverId) {
    throw new Error('Server ID is required for editing an MCP tool')
  }
  if (!config) {
    throw new Error('Config is required for editing an MCP tool')
  }

  // Verify server exists
  const [existing] = await db
    .select({ id: mcpServers.id, name: mcpServers.name })
    .from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
    .limit(1)

  if (!existing) {
    throw new Error(`MCP server with ID ${serverId} not found`)
  }

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  }

  if (config.name) updateData.name = config.name
  if (config.url) updateData.url = config.url
  if (config.transport) updateData.transport = config.transport
  if (config.headers) updateData.headers = config.headers
  if (config.timeout !== undefined) updateData.timeout = config.timeout
  if (config.enabled !== undefined) updateData.enabled = config.enabled

  await db.update(mcpServers).set(updateData).where(eq(mcpServers.id, serverId))

  const serverName = config.name || existing.name
  logger.info(`Updated MCP server: ${serverName}`, { serverId })

  return {
    success: true,
    operation: 'edit',
    serverId,
    serverName,
  }
}

async function deleteMcpServer(
  workspaceId: string,
  serverId: string | undefined
): Promise<ManageMcpToolResult> {
  if (!serverId) {
    throw new Error('Server ID is required for deleting an MCP tool')
  }

  await db
    .delete(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))

  logger.info(`Deleted MCP server: ${serverId}`)

  return {
    success: true,
    operation: 'delete',
    serverId,
  }
}
