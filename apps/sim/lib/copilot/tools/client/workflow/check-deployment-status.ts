import { Loader2, Rocket, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface CheckDeploymentStatusArgs {
  workflowId?: string
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

      const { activeWorkflowId } = useWorkflowRegistry.getState()
      const workflowId = args?.workflowId || activeWorkflowId

      if (!workflowId) {
        throw new Error('No workflow ID provided')
      }

      // Fetch deployment status from API
      const [apiDeployRes, chatDeployRes] = await Promise.all([
        fetch(`/api/workflows/${workflowId}/deploy`),
        fetch(`/api/workflows/${workflowId}/chat/status`),
      ])

      const apiDeploy = apiDeployRes.ok ? await apiDeployRes.json() : null
      const chatDeploy = chatDeployRes.ok ? await chatDeployRes.json() : null

      const isApiDeployed = apiDeploy?.isDeployed || false
      const isChatDeployed = !!(chatDeploy?.isDeployed && chatDeploy?.deployment)

      const deploymentTypes: string[] = []

      if (isApiDeployed) {
        // Default to sync API, could be extended to detect streaming/async
        deploymentTypes.push('api')
      }

      if (isChatDeployed) {
        deploymentTypes.push('chat')
      }

      const isDeployed = isApiDeployed || isChatDeployed

      this.setState(ClientToolCallState.success)
      await this.markToolComplete(
        200,
        isDeployed
          ? `Workflow is deployed as: ${deploymentTypes.join(', ')}`
          : 'Workflow is not deployed',
        {
          isDeployed,
          deploymentTypes,
          apiDeployed: isApiDeployed,
          chatDeployed: isChatDeployed,
          deployedAt: apiDeploy?.deployedAt || null,
        }
      )
    } catch (e: any) {
      logger.error('Check deployment status failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to check deployment status')
    }
  }
}
