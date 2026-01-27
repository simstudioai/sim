import { createLogger } from '@sim/logger'
import { Loader2, Rocket, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface CheckDeploymentStatusArgs {
  workflowId?: string
}

interface ApiDeploymentDetails {
  isDeployed: boolean
  deployedAt: string | null
  endpoint: string | null
  apiKey: string | null
  needsRedeployment: boolean
}

interface ChatDeploymentDetails {
  isDeployed: boolean
  chatId: string | null
  identifier: string | null
  chatUrl: string | null
  title: string | null
  description: string | null
  authType: string | null
  allowedEmails: string[] | null
  outputConfigs: Array<{ blockId: string; path: string }> | null
  welcomeMessage: string | null
  primaryColor: string | null
  hasPassword: boolean
}

interface McpDeploymentDetails {
  isDeployed: boolean
  servers: Array<{
    serverId: string
    serverName: string
    toolName: string
    toolDescription: string | null
    parameterSchema?: Record<string, unknown> | null
    toolId?: string | null
  }>
}

export class CheckDeploymentStatusClientTool extends BaseClientTool {
  static readonly id = 'check_deployment_status'

  constructor(toolCallId: string) {
    super(toolCallId, CheckDeploymentStatusClientTool.id, CheckDeploymentStatusClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Checking deployment status',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Checking deployment status', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Checking deployment status', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Checked deployment status', icon: Rocket },
      [ClientToolCallState.error]: { text: 'Failed to check deployment status', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted checking deployment status',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped checking deployment status',
        icon: XCircle,
      },
    },
    interrupt: undefined,
  }

  async execute(args?: CheckDeploymentStatusArgs): Promise<void> {
    const logger = createLogger('CheckDeploymentStatusClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      const { activeWorkflowId, workflows } = useWorkflowRegistry.getState()
      const workflowId = args?.workflowId || activeWorkflowId

      if (!workflowId) {
        throw new Error('No workflow ID provided')
      }

      const workflow = workflows[workflowId]
      const workspaceId = workflow?.workspaceId

      // Fetch deployment status from all sources
      const [apiDeployRes, chatDeployRes, mcpServersRes] = await Promise.all([
        fetch(`/api/workflows/${workflowId}/deploy`),
        fetch(`/api/workflows/${workflowId}/chat/status`),
        workspaceId ? fetch(`/api/mcp/workflow-servers?workspaceId=${workspaceId}`) : null,
      ])

      const apiDeploy = apiDeployRes.ok ? await apiDeployRes.json() : null
      const chatDeploy = chatDeployRes.ok ? await chatDeployRes.json() : null
      const mcpServers = mcpServersRes?.ok ? await mcpServersRes.json() : null

      // API deployment details
      const isApiDeployed = apiDeploy?.isDeployed || false
      const appUrl = typeof window !== 'undefined' ? window.location.origin : ''
      const apiDetails: ApiDeploymentDetails = {
        isDeployed: isApiDeployed,
        deployedAt: apiDeploy?.deployedAt || null,
        endpoint: isApiDeployed ? `${appUrl}/api/workflows/${workflowId}/execute` : null,
        apiKey: apiDeploy?.apiKey || null,
        needsRedeployment: apiDeploy?.needsRedeployment === true,
      }

      // Chat deployment details
      const isChatDeployed = !!(chatDeploy?.isDeployed && chatDeploy?.deployment)
      const chatDetails: ChatDeploymentDetails = {
        isDeployed: isChatDeployed,
        chatId: chatDeploy?.deployment?.id || null,
        identifier: chatDeploy?.deployment?.identifier || null,
        chatUrl: isChatDeployed ? `${appUrl}/chat/${chatDeploy?.deployment?.identifier}` : null,
        title: chatDeploy?.deployment?.title || null,
        description: chatDeploy?.deployment?.description || null,
        authType: chatDeploy?.deployment?.authType || null,
        allowedEmails: Array.isArray(chatDeploy?.deployment?.allowedEmails)
          ? chatDeploy?.deployment?.allowedEmails
          : null,
        outputConfigs: Array.isArray(chatDeploy?.deployment?.outputConfigs)
          ? chatDeploy?.deployment?.outputConfigs
          : null,
        welcomeMessage: chatDeploy?.deployment?.customizations?.welcomeMessage || null,
        primaryColor: chatDeploy?.deployment?.customizations?.primaryColor || null,
        hasPassword: chatDeploy?.deployment?.hasPassword === true,
      }

      // MCP deployment details - find servers that have this workflow as a tool
      const mcpServerList = mcpServers?.data?.servers || []
      const mcpToolDeployments: McpDeploymentDetails['servers'] = []

      for (const server of mcpServerList) {
        // Check if this workflow is deployed as a tool on this server
        if (server.toolNames && Array.isArray(server.toolNames)) {
          // We need to fetch the actual tools to check if this workflow is there
          try {
            const toolsRes = await fetch(
              `/api/mcp/workflow-servers/${server.id}/tools?workspaceId=${workspaceId}`
            )
            if (toolsRes.ok) {
              const toolsData = await toolsRes.json()
              const tools = toolsData.data?.tools || []
              for (const tool of tools) {
                if (tool.workflowId === workflowId) {
                  mcpToolDeployments.push({
                    serverId: server.id,
                    serverName: server.name,
                    toolName: tool.toolName,
                    toolDescription: tool.toolDescription,
                    parameterSchema: tool.parameterSchema ?? null,
                    toolId: tool.id ?? null,
                  })
                }
              }
            }
          } catch {
            // Skip this server if we can't fetch tools
          }
        }
      }

      const isMcpDeployed = mcpToolDeployments.length > 0
      const mcpDetails: McpDeploymentDetails = {
        isDeployed: isMcpDeployed,
        servers: mcpToolDeployments,
      }

      // Build deployment types list
      const deploymentTypes: string[] = []
      if (isApiDeployed) deploymentTypes.push('api')
      if (isChatDeployed) deploymentTypes.push('chat')
      if (isMcpDeployed) deploymentTypes.push('mcp')

      const isDeployed = isApiDeployed || isChatDeployed || isMcpDeployed

      // Build summary message
      let message = ''
      if (!isDeployed) {
        message = 'Workflow is not deployed'
      } else {
        const parts: string[] = []
        if (isApiDeployed) parts.push('API')
        if (isChatDeployed) parts.push(`Chat (${chatDetails.identifier})`)
        if (isMcpDeployed) {
          const serverNames = mcpToolDeployments.map((d) => d.serverName).join(', ')
          parts.push(`MCP (${serverNames})`)
        }
        message = `Workflow is deployed as: ${parts.join(', ')}`
      }

      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, message, {
        isDeployed,
        deploymentTypes,
        api: apiDetails,
        chat: chatDetails,
        mcp: mcpDetails,
      })

      logger.info('Checked deployment status', { isDeployed, deploymentTypes })
    } catch (e: any) {
      logger.error('Check deployment status failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to check deployment status')
    }
  }
}
