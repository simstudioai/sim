import { createLogger } from '@sim/logger'
import { Loader2, Server, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface ListWorkspaceMcpServersArgs {
  workspaceId?: string
}

export interface WorkspaceMcpServer {
  id: string
  name: string
  description: string | null
  toolCount: number
  toolNames: string[]
}

/**
 * List workspace MCP servers tool.
 * Returns a list of MCP servers available in the workspace that workflows can be deployed to.
 */
export class ListWorkspaceMcpServersClientTool extends BaseClientTool {
  static readonly id = 'list_workspace_mcp_servers'

  constructor(toolCallId: string) {
    super(
      toolCallId,
      ListWorkspaceMcpServersClientTool.id,
      ListWorkspaceMcpServersClientTool.metadata
    )
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Getting MCP servers',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Getting MCP servers', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Getting MCP servers', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Retrieved MCP servers', icon: Server },
      [ClientToolCallState.error]: { text: 'Failed to get MCP servers', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted getting MCP servers', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped getting MCP servers', icon: XCircle },
    },
    interrupt: undefined,
  }

  async execute(args?: ListWorkspaceMcpServersArgs): Promise<void> {
    const logger = createLogger('ListWorkspaceMcpServersClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      // Get workspace ID from active workflow if not provided
      const { activeWorkflowId, workflows } = useWorkflowRegistry.getState()
      let workspaceId = args?.workspaceId

      if (!workspaceId && activeWorkflowId) {
        workspaceId = workflows[activeWorkflowId]?.workspaceId
      }

      if (!workspaceId) {
        throw new Error('No workspace ID available')
      }

      const res = await fetch(`/api/mcp/workflow-servers?workspaceId=${workspaceId}`)

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to fetch MCP servers (${res.status})`)
      }

      const data = await res.json()
      const servers: WorkspaceMcpServer[] = (data.data?.servers || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        toolCount: s.toolCount || 0,
        toolNames: s.toolNames || [],
      }))

      this.setState(ClientToolCallState.success)

      if (servers.length === 0) {
        await this.markToolComplete(
          200,
          'No MCP servers found in this workspace. Use create_workspace_mcp_server to create one.',
          { servers: [], count: 0 }
        )
      } else {
        await this.markToolComplete(
          200,
          `Found ${servers.length} MCP server(s) in the workspace.`,
          {
            servers,
            count: servers.length,
          }
        )
      }

      logger.info(`Listed ${servers.length} MCP servers`)
    } catch (e: any) {
      logger.error('Failed to list MCP servers', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to list MCP servers')
    }
  }
}
