import { Loader2, Server, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

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

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}
