import { Loader2, Server, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

export interface ParameterDescription {
  name: string
  description: string
}

export interface DeployMcpArgs {
  /** The MCP server ID to deploy to (get from list_workspace_mcp_servers) */
  serverId: string
  /** Optional workflow ID (defaults to active workflow) */
  workflowId?: string
  /** Custom tool name (defaults to workflow name) */
  toolName?: string
  /** Custom tool description */
  toolDescription?: string
  /** Parameter descriptions to include in the schema */
  parameterDescriptions?: ParameterDescription[]
}

/**
 * Deploy MCP tool.
 * Deploys the workflow as an MCP tool to a workspace MCP server.
 */
export class DeployMcpClientTool extends BaseClientTool {
  static readonly id = 'deploy_mcp'

  constructor(toolCallId: string) {
    super(toolCallId, DeployMcpClientTool.id, DeployMcpClientTool.metadata)
  }

  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    return {
      accept: { text: 'Deploy to MCP', icon: Server },
      reject: { text: 'Skip', icon: XCircle },
    }
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Preparing to deploy to MCP',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Deploy to MCP server?', icon: Server },
      [ClientToolCallState.executing]: { text: 'Deploying to MCP', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Deployed to MCP', icon: Server },
      [ClientToolCallState.error]: { text: 'Failed to deploy to MCP', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted MCP deployment', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped MCP deployment', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Deploy', icon: Server },
      reject: { text: 'Skip', icon: XCircle },
    },
    uiConfig: {
      isSpecial: true,
      interrupt: {
        accept: { text: 'Deploy', icon: Server },
        reject: { text: 'Skip', icon: XCircle },
        showAllowOnce: true,
        showAllowAlways: true,
      },
    },
    getDynamicText: (params, state) => {
      const toolName = params?.toolName || 'workflow'
      switch (state) {
        case ClientToolCallState.success:
          return `Deployed "${toolName}" to MCP`
        case ClientToolCallState.executing:
          return `Deploying "${toolName}" to MCP`
        case ClientToolCallState.generating:
          return `Preparing to deploy to MCP`
        case ClientToolCallState.pending:
          return `Deploy "${toolName}" to MCP?`
        case ClientToolCallState.error:
          return `Failed to deploy to MCP`
      }
      return undefined
    },
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}

// Register UI config at module load
registerToolUIConfig(DeployMcpClientTool.id, DeployMcpClientTool.metadata.uiConfig!)
