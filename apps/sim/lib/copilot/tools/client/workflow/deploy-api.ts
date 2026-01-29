import { Loader2, Rocket, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'
import { useCopilotStore } from '@/stores/panel/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface DeployApiArgs {
  action: 'deploy' | 'undeploy'
  workflowId?: string
}

/**
 * Deploy API tool for deploying workflows as REST APIs.
 * This tool handles both deploying and undeploying workflows via the API endpoint.
 */
export class DeployApiClientTool extends BaseClientTool {
  static readonly id = 'deploy_api'

  constructor(toolCallId: string) {
    super(toolCallId, DeployApiClientTool.id, DeployApiClientTool.metadata)
  }

  /**
   * Override to provide dynamic button text based on action
   */
  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    const toolCallsById = useCopilotStore.getState().toolCallsById
    const toolCall = toolCallsById[this.toolCallId]
    const params = toolCall?.params as DeployApiArgs | undefined

    const action = params?.action || 'deploy'

    const workflowId = params?.workflowId || useWorkflowRegistry.getState().activeWorkflowId
    const isAlreadyDeployed = workflowId
      ? useWorkflowRegistry.getState().getWorkflowDeploymentStatus(workflowId)?.isDeployed
      : false

    let buttonText = action === 'undeploy' ? 'Undeploy' : 'Deploy'

    if (action === 'deploy' && isAlreadyDeployed) {
      buttonText = 'Redeploy'
    }

    return {
      accept: { text: buttonText, icon: Rocket },
      reject: { text: 'Skip', icon: XCircle },
    }
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Preparing to deploy API',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Deploy as API?', icon: Rocket },
      [ClientToolCallState.executing]: { text: 'Deploying API', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Deployed API', icon: Rocket },
      [ClientToolCallState.error]: { text: 'Failed to deploy API', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted deploying API',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped deploying API',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Deploy', icon: Rocket },
      reject: { text: 'Skip', icon: XCircle },
    },
    uiConfig: {
      isSpecial: true,
      interrupt: {
        accept: { text: 'Deploy', icon: Rocket },
        reject: { text: 'Skip', icon: XCircle },
        showAllowOnce: true,
        showAllowAlways: true,
      },
    },
    getDynamicText: (params, state) => {
      const action = params?.action === 'undeploy' ? 'undeploy' : 'deploy'

      const workflowId = params?.workflowId || useWorkflowRegistry.getState().activeWorkflowId
      const isAlreadyDeployed = workflowId
        ? useWorkflowRegistry.getState().getWorkflowDeploymentStatus(workflowId)?.isDeployed
        : false

      let actionText = action
      let actionTextIng = action === 'undeploy' ? 'undeploying' : 'deploying'
      const actionTextPast = action === 'undeploy' ? 'undeployed' : 'deployed'

      if (action === 'deploy' && isAlreadyDeployed) {
        actionText = 'redeploy'
        actionTextIng = 'redeploying'
      }

      const actionCapitalized = actionText.charAt(0).toUpperCase() + actionText.slice(1)

      switch (state) {
        case ClientToolCallState.success:
          return `API ${actionTextPast}`
        case ClientToolCallState.executing:
          return `${actionCapitalized}ing API`
        case ClientToolCallState.generating:
          return `Preparing to ${actionText} API`
        case ClientToolCallState.pending:
          return `${actionCapitalized} API?`
        case ClientToolCallState.error:
          return `Failed to ${actionText} API`
        case ClientToolCallState.aborted:
          return `Aborted ${actionTextIng} API`
        case ClientToolCallState.rejected:
          return `Skipped ${actionTextIng} API`
      }
      return undefined
    },
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}

// Register UI config at module load
registerToolUIConfig(DeployApiClientTool.id, DeployApiClientTool.metadata.uiConfig!)
