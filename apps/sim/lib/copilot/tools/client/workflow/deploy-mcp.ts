import { createLogger } from '@sim/logger'
import { Loader2, Server, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: DeployMcpArgs): Promise<void> {
    const logger = createLogger('DeployMcpClientTool')
    try {
      if (!args?.serverId) {
        throw new Error(
          'Server ID is required. Use list_workspace_mcp_servers to get available servers.'
        )
      }

      const { activeWorkflowId, workflows } = useWorkflowRegistry.getState()
      const workflowId = args?.workflowId || activeWorkflowId

      if (!workflowId) {
        throw new Error('No workflow ID available')
      }

      const workflow = workflows[workflowId]
      const workspaceId = workflow?.workspaceId

      if (!workspaceId) {
        throw new Error('Workflow workspace not found')
      }

      // Check if workflow is deployed
      const deploymentStatus = useWorkflowRegistry
        .getState()
        .getWorkflowDeploymentStatus(workflowId)
      if (!deploymentStatus?.isDeployed) {
        throw new Error(
          'Workflow must be deployed before adding as an MCP tool. Use deploy_api first.'
        )
      }

      this.setState(ClientToolCallState.executing)

      let parameterSchema: Record<string, unknown> | undefined
      if (args?.parameterDescriptions && args.parameterDescriptions.length > 0) {
        const properties: Record<string, { description: string }> = {}
        for (const param of args.parameterDescriptions) {
          properties[param.name] = { description: param.description }
        }
        parameterSchema = { properties }
      }

      const res = await fetch(
        `/api/mcp/workflow-servers/${args.serverId}/tools?workspaceId=${workspaceId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflowId,
            toolName: args.toolName?.trim(),
            toolDescription: args.toolDescription?.trim(),
            parameterSchema,
          }),
        }
      )

      const data = await res.json()

      if (!res.ok) {
        if (data.error?.includes('already added')) {
          const toolsRes = await fetch(
            `/api/mcp/workflow-servers/${args.serverId}/tools?workspaceId=${workspaceId}`
          )
          const toolsJson = toolsRes.ok ? await toolsRes.json() : null
          const tools = toolsJson?.data?.tools || []
          const existingTool = tools.find((tool: any) => tool.workflowId === workflowId)
          if (!existingTool?.id) {
            throw new Error('This workflow is already deployed to this MCP server')
          }
          const patchRes = await fetch(
            `/api/mcp/workflow-servers/${args.serverId}/tools/${existingTool.id}?workspaceId=${workspaceId}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                toolName: args.toolName?.trim(),
                toolDescription: args.toolDescription?.trim(),
                parameterSchema,
              }),
            }
          )
          const patchJson = patchRes.ok ? await patchRes.json() : null
          if (!patchRes.ok) {
            const patchError = patchJson?.error || `Failed to update MCP tool (${patchRes.status})`
            throw new Error(patchError)
          }
          const updatedTool = patchJson?.data?.tool
          this.setState(ClientToolCallState.success)
          await this.markToolComplete(
            200,
            `Workflow MCP tool updated to "${updatedTool?.toolName || existingTool.toolName}".`,
            {
              success: true,
              toolId: updatedTool?.id || existingTool.id,
              toolName: updatedTool?.toolName || existingTool.toolName,
              toolDescription: updatedTool?.toolDescription || existingTool.toolDescription,
              serverId: args.serverId,
              updated: true,
            }
          )
          logger.info('Updated workflow MCP tool', { toolId: existingTool.id })
          return
        }
        if (data.error?.includes('not deployed')) {
          throw new Error('Workflow must be deployed before adding as an MCP tool')
        }
        if (data.error?.includes('Start block')) {
          throw new Error('Workflow must have a Start block to be used as an MCP tool')
        }
        if (data.error?.includes('Server not found')) {
          throw new Error(
            'MCP server not found. Use list_workspace_mcp_servers to see available servers.'
          )
        }
        throw new Error(data.error || `Failed to deploy to MCP (${res.status})`)
      }

      const tool = data.data?.tool
      if (!tool) {
        throw new Error('Response missing tool data')
      }

      this.setState(ClientToolCallState.success)
      await this.markToolComplete(
        200,
        `Workflow deployed as MCP tool "${tool.toolName}" to server.`,
        {
          success: true,
          toolId: tool.id,
          toolName: tool.toolName,
          toolDescription: tool.toolDescription,
          serverId: args.serverId,
        }
      )

      logger.info(`Deployed workflow as MCP tool: ${tool.toolName}`)
    } catch (e: any) {
      logger.error('Failed to deploy to MCP', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to deploy to MCP', {
        success: false,
        error: e?.message,
      })
    }
  }

  async execute(args?: DeployMcpArgs): Promise<void> {
    await this.handleAccept(args)
  }
}

// Register UI config at module load
registerToolUIConfig(DeployMcpClientTool.id, DeployMcpClientTool.metadata.uiConfig!)
