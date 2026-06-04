import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import {
  performCreateMcpServer,
  performDeleteMcpServer,
  performUpdateMcpServer,
} from '@/lib/mcp/orchestration'

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

      const result = await performCreateMcpServer({
        workspaceId,
        userId: context.userId,
        name: config.name,
        description: '',
        transport: config.transport || 'streamable-http',
        url: config.url,
        headers: config.headers,
        timeout: config.timeout,
        retries: 3,
        enabled: config.enabled,
        source: 'tool_input',
      })
      if (!result.success || !result.serverId) {
        return {
          success: false,
          error: result.error || `Failed to add MCP server "${config.name}"`,
        }
      }

      return {
        success: true,
        output: {
          success: true,
          operation,
          serverId: result.serverId,
          name: config.name,
          message: result.updated
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

      const result = await performUpdateMcpServer({
        workspaceId,
        userId: context.userId,
        serverId: params.serverId,
        name: config.name,
        transport: config.transport,
        url: config.url,
        headers: config.headers,
        timeout: config.timeout,
        enabled: config.enabled,
      })
      if (!result.success || !result.server) {
        return { success: false, error: `MCP server not found: ${params.serverId}` }
      }

      return {
        success: true,
        output: {
          success: true,
          operation,
          serverId: params.serverId,
          name: result.server.name,
          message: `Updated MCP server "${result.server.name}"`,
        },
      }
    }

    if (operation === 'delete') {
      if (!params.serverId) {
        return { success: false, error: "'serverId' is required for 'delete'" }
      }

      const result = await performDeleteMcpServer({
        workspaceId,
        userId: context.userId,
        serverId: params.serverId,
        source: 'tool_input',
      })
      if (!result.success || !result.server) {
        return { success: false, error: `MCP server not found: ${params.serverId}` }
      }

      return {
        success: true,
        output: {
          success: true,
          operation,
          serverId: params.serverId,
          message: `Deleted MCP server "${result.server.name}"`,
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
      error: getErrorMessage(error, 'Failed to manage MCP server'),
    }
  }
}
