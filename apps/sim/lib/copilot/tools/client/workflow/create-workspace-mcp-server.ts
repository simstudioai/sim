import { Loader2, Plus, Server, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { useCopilotStore } from '@/stores/panel/copilot/store'

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

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}
