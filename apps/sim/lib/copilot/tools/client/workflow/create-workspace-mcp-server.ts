import { createLogger } from '@sim/logger'
import { Loader2, Plus, Server, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { useCopilotStore } from '@/stores/panel/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export interface CreateWorkspaceMcpServerArgs {
  /** Name of the MCP server */
  name: string
  /** Optional description */
  description?: string
  workspaceId?: string
}

/**
 * Create workspace MCP server tool.
 * Creates a new MCP server in the workspace that workflows can be deployed to as tools.
 */
export class CreateWorkspaceMcpServerClientTool extends BaseClientTool {
  static readonly id = 'create_workspace_mcp_server'

  constructor(toolCallId: string) {
    super(
      toolCallId,
      CreateWorkspaceMcpServerClientTool.id,
      CreateWorkspaceMcpServerClientTool.metadata
    )
  }

  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    const toolCallsById = useCopilotStore.getState().toolCallsById
    const toolCall = toolCallsById[this.toolCallId]
    const params = toolCall?.params as CreateWorkspaceMcpServerArgs | undefined

    const serverName = params?.name || 'MCP Server'

    return {
      accept: { text: `Create "${serverName}"`, icon: Plus },
      reject: { text: 'Skip', icon: XCircle },
    }
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Preparing to create MCP server',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Create MCP server?', icon: Server },
      [ClientToolCallState.executing]: { text: 'Creating MCP server', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Created MCP server', icon: Server },
      [ClientToolCallState.error]: { text: 'Failed to create MCP server', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted creating MCP server', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped creating MCP server', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Create', icon: Plus },
      reject: { text: 'Skip', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const name = params?.name || 'MCP server'
      switch (state) {
        case ClientToolCallState.success:
          return `Created MCP server "${name}"`
        case ClientToolCallState.executing:
          return `Creating MCP server "${name}"`
        case ClientToolCallState.generating:
          return `Preparing to create "${name}"`
        case ClientToolCallState.pending:
          return `Create MCP server "${name}"?`
        case ClientToolCallState.error:
          return `Failed to create "${name}"`
      }
      return undefined
    },
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: CreateWorkspaceMcpServerArgs): Promise<void> {
    const logger = createLogger('CreateWorkspaceMcpServerClientTool')
    try {
      if (!args?.name) {
        throw new Error('Server name is required')
      }

      // Get workspace ID from active workflow if not provided
      const { activeWorkflowId, workflows } = useWorkflowRegistry.getState()
      let workspaceId = args?.workspaceId

      if (!workspaceId && activeWorkflowId) {
        workspaceId = workflows[activeWorkflowId]?.workspaceId
      }

      if (!workspaceId) {
        throw new Error('No workspace ID available')
      }

      this.setState(ClientToolCallState.executing)

      const res = await fetch('/api/mcp/workflow-servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          name: args.name.trim(),
          description: args.description?.trim() || null,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || `Failed to create MCP server (${res.status})`)
      }

      const server = data.data?.server
      if (!server) {
        throw new Error('Server creation response missing server data')
      }

      this.setState(ClientToolCallState.success)
      await this.markToolComplete(
        200,
        `MCP server "${args.name}" created successfully. You can now deploy workflows to it using deploy_mcp.`,
        {
          success: true,
          serverId: server.id,
          serverName: server.name,
          description: server.description,
        }
      )

      logger.info(`Created MCP server: ${server.name} (${server.id})`)
    } catch (e: any) {
      logger.error('Failed to create MCP server', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to create MCP server', {
        success: false,
        error: e?.message,
      })
    }
  }

  async execute(args?: CreateWorkspaceMcpServerArgs): Promise<void> {
    await this.handleAccept(args)
  }
}
