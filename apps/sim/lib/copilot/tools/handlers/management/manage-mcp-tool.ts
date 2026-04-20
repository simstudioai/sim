import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { validateMcpDomain } from '@/lib/mcp/domain-check'
import { mcpService } from '@/lib/mcp/service'
import { generateMcpServerId } from '@/lib/mcp/utils'

const logger = createLogger('CopilotToolExecutor')

type ManageMcpToolOperation = 'add' | 'edit' | 'delete' | 'list'

interface ManageMcpToolConfig {
  name?: string
  transport?: string
  url?: string
  headers?: Record<string, string>
  timeout?: number
  enabled?: boolean
}

interface ManageMcpToolParams {
  operation?: string
  serverId?: string
  config?: ManageMcpToolConfig
}

export async function executeManageMcpTool(
  rawParams: Record<string, unknown>,
  context: ExecutionContext
): Promise<ToolCallResult> {
  const params = rawParams as ManageMcpToolParams
  const operation = String(params.operation || '').toLowerCase() as ManageMcpToolOperation
  const workspaceId = context.workspaceId

  if (!operation) {
    return { success: false, error: "Missing required 'operation' argument" }
  }

  if (!workspaceId) {
    return { success: false, error: 'workspaceId is required' }
  }

  const writeOps: string[] = ['add', 'edit', 'delete']
  if (
    writeOps.includes(operation) &&
    context.userPermission &&
    context.userPermission !== 'write' &&
    context.userPermission !== 'admin'
  ) {
    return {
      success: false,
      error: `Permission denied: '${operation}' on manage_mcp_tool requires write access. You have '${context.userPermission}' permission.`,
    }
  }

  try {
    if (operation === 'list') {
      const servers = await db
        .select()
        .from(mcpServers)
        .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))

      return {
        success: true,
        output: {
          success: true,
          operation,
          servers: servers.map((s) => ({
            id: s.id,
            name: s.name,
            url: s.url,
            transport: s.transport,
            enabled: s.enabled,
            connectionStatus: s.connectionStatus,
          })),
          count: servers.length,
        },
      }
    }

    if (operation === 'add') {
      const config = params.config
      if (!config?.name || !config?.url) {
        return { success: false, error: "config.name and config.url are required for 'add'" }
      }

      validateMcpDomain(config.url)

      const serverId = generateMcpServerId(workspaceId, config.url)

      const [existing] = await db
        .select({ id: mcpServers.id, deletedAt: mcpServers.deletedAt })
        .from(mcpServers)
        .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
        .limit(1)

      if (existing) {
        await db
          .update(mcpServers)
          .set({
            name: config.name,
            transport: config.transport || 'streamable-http',
            url: config.url,
            headers: config.headers || {},
            timeout: config.timeout || 30000,
            enabled: config.enabled !== false,
            connectionStatus: 'connected',
            lastConnected: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          })
          .where(eq(mcpServers.id, serverId))
      } else {
        await db.insert(mcpServers).values({
          id: serverId,
          workspaceId,
          createdBy: context.userId,
          name: config.name,
          description: '',
          transport: config.transport || 'streamable-http',
          url: config.url,
          headers: config.headers || {},
          timeout: config.timeout || 30000,
          retries: 3,
          enabled: config.enabled !== false,
          connectionStatus: 'connected',
          lastConnected: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }

      await mcpService.clearCache(workspaceId)

      return {
        success: true,
        output: {
          success: true,
          operation,
          serverId,
          name: config.name,
          message: existing
            ? `Updated existing MCP server "${config.name}"`
            : `Added MCP server "${config.name}"`,
        },
      }
    }

    if (operation === 'edit') {
      if (!params.serverId) {
        return { success: false, error: "'serverId' is required for 'edit'" }
      }
      const config = params.config
      if (!config) {
        return { success: false, error: "'config' is required for 'edit'" }
      }

      if (config.url) {
        validateMcpDomain(config.url)
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (config.name !== undefined) updateData.name = config.name
      if (config.transport !== undefined) updateData.transport = config.transport
      if (config.url !== undefined) updateData.url = config.url
      if (config.headers !== undefined) updateData.headers = config.headers
      if (config.timeout !== undefined) updateData.timeout = config.timeout
      if (config.enabled !== undefined) updateData.enabled = config.enabled

      const [updated] = await db
        .update(mcpServers)
        .set(updateData)
        .where(
          and(
            eq(mcpServers.id, params.serverId),
            eq(mcpServers.workspaceId, workspaceId),
            isNull(mcpServers.deletedAt)
          )
        )
        .returning()

      if (!updated) {
        return { success: false, error: `MCP server not found: ${params.serverId}` }
      }

      await mcpService.clearCache(workspaceId)

      return {
        success: true,
        output: {
          success: true,
          operation,
          serverId: params.serverId,
          name: updated.name,
          message: `Updated MCP server "${updated.name}"`,
        },
      }
    }

    if (operation === 'delete') {
      if (!params.serverId) {
        return { success: false, error: "'serverId' is required for 'delete'" }
      }

      const [deleted] = await db
        .delete(mcpServers)
        .where(and(eq(mcpServers.id, params.serverId), eq(mcpServers.workspaceId, workspaceId)))
        .returning()

      if (!deleted) {
        return { success: false, error: `MCP server not found: ${params.serverId}` }
      }

      await mcpService.clearCache(workspaceId)

      return {
        success: true,
        output: {
          success: true,
          operation,
          serverId: params.serverId,
          message: `Deleted MCP server "${deleted.name}"`,
        },
      }
    }

    return { success: false, error: `Unsupported operation for manage_mcp_tool: ${operation}` }
  } catch (error) {
    logger.error(
      context.messageId
        ? `manage_mcp_tool execution failed [messageId:${context.messageId}]`
        : 'manage_mcp_tool execution failed',
      {
        operation,
        workspaceId,
        error: toError(error).message,
      }
    )
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to manage MCP server',
    }
  }
}
