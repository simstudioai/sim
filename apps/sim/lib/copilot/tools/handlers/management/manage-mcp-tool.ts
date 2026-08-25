import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { executeCopilotMcpServerUseCase } from '@/lib/copilot/application/execute-mcp-server-use-case'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  deleteMcpServerUseCase,
  listMcpServersUseCase,
  reconfigureMcpServerUseCase,
  registerMcpServerUseCase,
} from '@/lib/mcp/application/use-cases'
import { captureServerEvent } from '@/lib/posthog/server'

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

  try {
    if (operation === 'list') {
      const { servers } = await executeCopilotMcpServerUseCase(context, listMcpServersUseCase, {
        workspaceId,
      })

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

      const result = await executeCopilotMcpServerUseCase(context, registerMcpServerUseCase, {
        workspaceId,
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
      if (!result.updated) {
        captureServerEvent(
          context.userId,
          'mcp_server_connected',
          {
            workspace_id: workspaceId,
            server_name: result.server.name,
            transport: result.server.transport,
            source: 'tool_input',
          },
          {
            groups: { workspace: workspaceId },
            setOnce: { first_mcp_connected_at: new Date().toISOString() },
          }
        )
      }

      return {
        success: true,
        resources: [
          { type: 'mcp_server', id: result.server.id, title: result.server.name || config.name },
        ],
        output: {
          success: true,
          operation,
          serverId: result.server.id,
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

      const result = await executeCopilotMcpServerUseCase(context, reconfigureMcpServerUseCase, {
        workspaceId,
        serverId: params.serverId,
        name: config.name,
        transport: config.transport,
        url: config.url,
        headers: config.headers,
        timeout: config.timeout,
        enabled: config.enabled,
        source: 'tool_input',
      })

      return {
        success: true,
        resources: [
          { type: 'mcp_server', id: result.server.id, title: result.server.name || 'MCP Server' },
        ],
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

      const result = await executeCopilotMcpServerUseCase(context, deleteMcpServerUseCase, {
        workspaceId,
        serverId: params.serverId,
        source: 'tool_input',
      })
      captureServerEvent(
        context.userId,
        'mcp_server_disconnected',
        {
          workspace_id: workspaceId,
          server_name: result.server.name,
          source: 'tool_input',
        },
        { groups: { workspace: workspaceId } }
      )

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

    return {
      success: false,
      error: `Unsupported operation for manage_mcp_connection: ${operation}`,
    }
  } catch (error) {
    logger.error(
      context.messageId
        ? `manage_mcp_connection execution failed [messageId:${context.messageId}]`
        : 'manage_mcp_connection execution failed',
      {
        operation,
        workspaceId,
        error: toError(error).message,
      }
    )
    const classified = asOrchestrationError(error)
    return {
      success: false,
      error:
        classified && classified.code !== 'internal'
          ? classified.message
          : `The ${operation ?? 'MCP server'} operation failed inside Sim. The write may or may not have landed — run operation "list" to check current state before retrying.`,
    }
  }
}
