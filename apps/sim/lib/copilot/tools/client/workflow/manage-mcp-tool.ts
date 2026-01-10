import { createLogger } from '@sim/logger'
import { Check, Loader2, Server, X, XCircle } from 'lucide-react'
import { client } from '@/lib/auth/auth-client'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { useCopilotStore } from '@/stores/panel/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface McpServerConfig {
  name: string
  transport: 'streamable-http'
  url?: string
  headers?: Record<string, string>
  timeout?: number
  enabled?: boolean
}

interface ManageMcpToolArgs {
  operation: 'add' | 'edit' | 'delete'
  serverId?: string
  config?: McpServerConfig
}

const API_ENDPOINT = '/api/mcp/servers'

async function checkMcpToolsPermission(): Promise<void> {
  const activeOrgResponse = await client.organization.getFullOrganization()
  const organizationId = activeOrgResponse.data?.id
  if (!organizationId) return

  const response = await fetch(`/api/permission-groups/user?organizationId=${organizationId}`)
  if (!response.ok) return

  const data = await response.json()
  if (data?.config?.disableMcpTools) {
    throw new Error('MCP tools are not allowed based on your permission group settings')
  }
}

/**
 * Client tool for creating, editing, and deleting MCP tool servers via the copilot.
 */
export class ManageMcpToolClientTool extends BaseClientTool {
  static readonly id = 'manage_mcp_tool'
  private currentArgs?: ManageMcpToolArgs

  constructor(toolCallId: string) {
    super(toolCallId, ManageMcpToolClientTool.id, ManageMcpToolClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Managing MCP tool',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Manage MCP tool?', icon: Server },
      [ClientToolCallState.executing]: { text: 'Managing MCP tool', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Managed MCP tool', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to manage MCP tool', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted managing MCP tool',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped managing MCP tool',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Allow', icon: Check },
      reject: { text: 'Skip', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const operation = params?.operation as 'add' | 'edit' | 'delete' | undefined

      if (!operation) return undefined

      const serverName = params?.config?.name || params?.serverName

      const getActionText = (verb: 'present' | 'past' | 'gerund') => {
        switch (operation) {
          case 'add':
            return verb === 'present' ? 'Add' : verb === 'past' ? 'Added' : 'Adding'
          case 'edit':
            return verb === 'present' ? 'Edit' : verb === 'past' ? 'Edited' : 'Editing'
          case 'delete':
            return verb === 'present' ? 'Delete' : verb === 'past' ? 'Deleted' : 'Deleting'
        }
      }

      const shouldShowServerName = (currentState: ClientToolCallState) => {
        if (operation === 'add') {
          return currentState === ClientToolCallState.success
        }
        return true
      }

      const nameText = shouldShowServerName(state) && serverName ? ` ${serverName}` : ' MCP tool'

      switch (state) {
        case ClientToolCallState.success:
          return `${getActionText('past')}${nameText}`
        case ClientToolCallState.executing:
          return `${getActionText('gerund')}${nameText}`
        case ClientToolCallState.generating:
          return `${getActionText('gerund')}${nameText}`
        case ClientToolCallState.pending:
          return `${getActionText('present')}${nameText}?`
        case ClientToolCallState.error:
          return `Failed to ${getActionText('present')?.toLowerCase()}${nameText}`
        case ClientToolCallState.aborted:
          return `Aborted ${getActionText('gerund')?.toLowerCase()}${nameText}`
        case ClientToolCallState.rejected:
          return `Skipped ${getActionText('gerund')?.toLowerCase()}${nameText}`
      }
      return undefined
    },
  }

  /**
   * Gets the tool call args from the copilot store (needed before execute() is called)
   */
  private getArgsFromStore(): ManageMcpToolArgs | undefined {
    try {
      const { toolCallsById } = useCopilotStore.getState()
      const toolCall = toolCallsById[this.toolCallId]
      return (toolCall as any)?.params as ManageMcpToolArgs | undefined
    } catch {
      return undefined
    }
  }

  /**
   * Override getInterruptDisplays to only show confirmation for edit and delete operations.
   * Add operations execute directly without confirmation.
   */
  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    const args = this.currentArgs || this.getArgsFromStore()
    const operation = args?.operation
    if (operation === 'edit' || operation === 'delete') {
      return this.metadata.interrupt
    }
    return undefined
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: ManageMcpToolArgs): Promise<void> {
    const logger = createLogger('ManageMcpToolClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      await this.executeOperation(args, logger)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to manage MCP tool', {
        success: false,
        error: e?.message || 'Failed to manage MCP tool',
      })
    }
  }

  async execute(args?: ManageMcpToolArgs): Promise<void> {
    this.currentArgs = args
    if (args?.operation === 'add') {
      await this.handleAccept(args)
    }
  }

  /**
   * Executes the MCP tool operation (add, edit, or delete)
   */
  private async executeOperation(
    args: ManageMcpToolArgs | undefined,
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    if (!args?.operation) {
      throw new Error('Operation is required')
    }

    await checkMcpToolsPermission()

    const { operation, serverId, config } = args

    const { hydration } = useWorkflowRegistry.getState()
    const workspaceId = hydration.workspaceId
    if (!workspaceId) {
      throw new Error('No active workspace found')
    }

    logger.info(`Executing MCP tool operation: ${operation}`, {
      operation,
      serverId,
      serverName: config?.name,
      workspaceId,
    })

    switch (operation) {
      case 'add':
        await this.addMcpServer({ config, workspaceId }, logger)
        break
      case 'edit':
        await this.editMcpServer({ serverId, config, workspaceId }, logger)
        break
      case 'delete':
        await this.deleteMcpServer({ serverId, workspaceId }, logger)
        break
      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
  }

  /**
   * Creates a new MCP server
   */
  private async addMcpServer(
    params: {
      config?: McpServerConfig
      workspaceId: string
    },
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    const { config, workspaceId } = params

    if (!config) {
      throw new Error('Config is required for adding an MCP tool')
    }
    if (!config.name) {
      throw new Error('Server name is required')
    }
    if (!config.url) {
      throw new Error('Server URL is required for streamable-http transport')
    }

    const serverData = {
      ...config,
      workspaceId,
      transport: config.transport || 'streamable-http',
      timeout: config.timeout || 30000,
      enabled: config.enabled !== false,
    }

    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(serverData),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create MCP tool')
    }

    const serverId = data.data?.serverId
    logger.info(`Created MCP tool: ${config.name}`, { serverId })

    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, `Created MCP tool "${config.name}"`, {
      success: true,
      operation: 'add',
      serverId,
      serverName: config.name,
    })
  }

  /**
   * Updates an existing MCP server
   */
  private async editMcpServer(
    params: {
      serverId?: string
      config?: McpServerConfig
      workspaceId: string
    },
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    const { serverId, config, workspaceId } = params

    if (!serverId) {
      throw new Error('Server ID is required for editing an MCP tool')
    }

    if (!config) {
      throw new Error('Config is required for editing an MCP tool')
    }

    const updateData = {
      ...config,
      workspaceId,
    }

    const response = await fetch(`${API_ENDPOINT}/${serverId}?workspaceId=${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to update MCP tool')
    }

    const serverName = config.name || data.data?.server?.name || serverId
    logger.info(`Updated MCP tool: ${serverName}`, { serverId })

    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, `Updated MCP tool "${serverName}"`, {
      success: true,
      operation: 'edit',
      serverId,
      serverName,
    })
  }

  /**
   * Deletes an MCP server
   */
  private async deleteMcpServer(
    params: {
      serverId?: string
      workspaceId: string
    },
    logger: ReturnType<typeof createLogger>
  ): Promise<void> {
    const { serverId, workspaceId } = params

    if (!serverId) {
      throw new Error('Server ID is required for deleting an MCP tool')
    }

    const url = `${API_ENDPOINT}?serverId=${serverId}&workspaceId=${workspaceId}`
    const response = await fetch(url, {
      method: 'DELETE',
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete MCP tool')
    }

    logger.info(`Deleted MCP tool: ${serverId}`)

    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, `Deleted MCP tool`, {
      success: true,
      operation: 'delete',
      serverId,
    })
  }
}
