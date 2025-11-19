import { Loader2, Rocket, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { useCopilotStore } from '@/stores/panel-new/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { getInputFormatExample } from '@/lib/workflows/deployment-utils'

interface DeployWorkflowArgs {
  action: 'deploy' | 'undeploy'
  deployType?: 'api' | 'chat'
  workflowId?: string
}

interface ApiKeysData {
  workspaceKeys: Array<{ id: string; name: string }>
  personalKeys: Array<{ id: string; name: string }>
}

export class DeployWorkflowClientTool extends BaseClientTool {
  static readonly id = 'deploy_workflow'

  constructor(toolCallId: string) {
    super(toolCallId, DeployWorkflowClientTool.id, DeployWorkflowClientTool.metadata)
  }

  /**
   * Override to provide dynamic button text based on action and deployType
   */
  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    // Get params from the copilot store
    const toolCallsById = useCopilotStore.getState().toolCallsById
    const toolCall = toolCallsById[this.toolCallId]
    const params = toolCall?.params as DeployWorkflowArgs | undefined
    
    const action = params?.action || 'deploy'
    const deployType = params?.deployType || 'api'
    
    // Check if workflow is already deployed
    const workflowId = params?.workflowId || useWorkflowRegistry.getState().activeWorkflowId
    const isAlreadyDeployed = workflowId 
      ? useWorkflowRegistry.getState().getWorkflowDeploymentStatus(workflowId)?.isDeployed 
      : false
    
    let buttonText = action.charAt(0).toUpperCase() + action.slice(1)
    
    // Change to "Redeploy" if already deployed
    if (action === 'deploy' && isAlreadyDeployed) {
      buttonText = 'Redeploy'
    } else if (action === 'deploy' && deployType === 'chat') {
      buttonText = 'Deploy as chat'
    }
    
    return {
      accept: { text: buttonText, icon: Rocket },
      reject: { text: 'Skip', icon: XCircle },
    }
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Preparing to deploy workflow',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Deploy workflow?', icon: Rocket },
      [ClientToolCallState.executing]: { text: 'Deploying workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Deployed workflow', icon: Rocket },
      [ClientToolCallState.error]: { text: 'Failed to deploy workflow', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted deploying workflow',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped deploying workflow',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Deploy', icon: Rocket },
      reject: { text: 'Skip', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const action = params?.action === 'undeploy' ? 'undeploy' : 'deploy'
      const deployType = params?.deployType || 'api'
      
      // Check if workflow is already deployed
      const workflowId = params?.workflowId || useWorkflowRegistry.getState().activeWorkflowId
      const isAlreadyDeployed = workflowId 
        ? useWorkflowRegistry.getState().getWorkflowDeploymentStatus(workflowId)?.isDeployed 
        : false
      
      // Determine action text based on deployment status
      let actionText = action
      let actionTextIng = action === 'undeploy' ? 'undeploying' : 'deploying'
      let actionTextPast = action === 'undeploy' ? 'undeployed' : 'deployed'
      
      // If already deployed and action is deploy, change to redeploy
      if (action === 'deploy' && isAlreadyDeployed) {
        actionText = 'redeploy'
        actionTextIng = 'redeploying'
        actionTextPast = 'redeployed'
      }
      
      const actionCapitalized = actionText.charAt(0).toUpperCase() + actionText.slice(1)
      
      // Special text for chat deployment
      const isChatDeploy = action === 'deploy' && deployType === 'chat'
      const displayAction = isChatDeploy ? 'deploy as chat' : actionText
      const displayActionCapitalized = isChatDeploy ? 'Deploy as chat' : actionCapitalized

      switch (state) {
        case ClientToolCallState.success:
          return isChatDeploy ? 'Opened chat deployment settings' : `${actionCapitalized}ed workflow`
        case ClientToolCallState.executing:
          return isChatDeploy ? 'Opening chat deployment settings' : `${actionCapitalized}ing workflow`
        case ClientToolCallState.generating:
          return `Preparing to ${displayAction} workflow`
        case ClientToolCallState.pending:
          return `${displayActionCapitalized} workflow?`
        case ClientToolCallState.error:
          return `Failed to ${displayAction} workflow`
        case ClientToolCallState.aborted:
          return isChatDeploy ? 'Aborted opening chat deployment' : `Aborted ${actionTextIng} workflow`
        case ClientToolCallState.rejected:
          return isChatDeploy ? 'Skipped opening chat deployment' : `Skipped ${actionTextIng} workflow`
      }
      return undefined
    },
  }

  /**
   * Checks if the user has any API keys (workspace or personal)
   */
  private async hasApiKeys(workspaceId: string): Promise<boolean> {
    try {
      const [workspaceRes, personalRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/api-keys`),
        fetch('/api/users/me/api-keys'),
      ])

      if (!workspaceRes.ok || !personalRes.ok) {
        return false
      }

      const workspaceData = await workspaceRes.json()
      const personalData = await personalRes.json()

      const workspaceKeys = (workspaceData?.keys || []) as Array<any>
      const personalKeys = (personalData?.keys || []) as Array<any>

      return workspaceKeys.length > 0 || personalKeys.length > 0
    } catch (error) {
      const logger = createLogger('DeployWorkflowClientTool')
      logger.warn('Failed to check API keys:', error)
      return false
    }
  }

  /**
   * Opens the settings modal to the API keys tab
   */
  private openApiKeysModal(): void {
    window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'apikeys' } }))
  }

  /**
   * Opens the deploy modal to the chat tab
   */
  private openDeployModal(tab: 'api' | 'chat' = 'api'): void {
    window.dispatchEvent(new CustomEvent('open-deploy-modal', { detail: { tab } }))
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: DeployWorkflowArgs): Promise<void> {
    const logger = createLogger('DeployWorkflowClientTool')
    try {
      const action = args?.action || 'deploy'
      const deployType = args?.deployType || 'api'
      const { activeWorkflowId, workflows } = useWorkflowRegistry.getState()
      const workflowId = args?.workflowId || activeWorkflowId

      if (!workflowId) {
        throw new Error('No workflow ID provided')
      }

      const workflow = workflows[workflowId]
      const workspaceId = workflow?.workspaceId

      // For chat deployment, just open the deploy modal
      if (action === 'deploy' && deployType === 'chat') {
        this.setState(ClientToolCallState.success)
        this.openDeployModal('chat')
        await this.markToolComplete(
          200,
          'Opened chat deployment settings. Configure and deploy your workflow as a chat interface.',
          {
            action,
            deployType,
            openedModal: true,
          }
        )
        return
      }

      // For deploy action, check if user has API keys first
      if (action === 'deploy') {
        if (!workspaceId) {
          throw new Error('Workflow workspace not found')
        }

        const hasKeys = await this.hasApiKeys(workspaceId)

        if (!hasKeys) {
          // Mark as rejected since we can't deploy without an API key
          this.setState(ClientToolCallState.rejected)
          
          // Open the API keys modal to help user create one
          this.openApiKeysModal()
          
          await this.markToolComplete(
            200,
            'Cannot deploy without an API key. Opened API key settings so you can create one. Once you have an API key, try deploying again.',
            {
              needsApiKey: true,
              message:
                'You need to create an API key before you can deploy your workflow. The API key settings have been opened for you. After creating an API key, you can deploy your workflow.',
            }
          )
          return
        }
      }

      this.setState(ClientToolCallState.executing)

      // Perform the deploy/undeploy action
      const endpoint = `/api/workflows/${workflowId}/deploy`
      const method = action === 'deploy' ? 'POST' : 'DELETE'

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: action === 'deploy' ? JSON.stringify({ deployChatEnabled: false }) : undefined,
      })

      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(txt || `Server error (${res.status})`)
      }

      const json = await res.json()
      
      let successMessage = ''
      let resultData: any = {
        action,
        isDeployed: action === 'deploy',
        deployedAt: json.deployedAt,
      }

      if (action === 'deploy') {
        // Generate the curl command for the deployed workflow (matching deploy modal format)
        const appUrl = typeof window !== 'undefined' 
          ? window.location.origin 
          : process.env.NEXT_PUBLIC_APP_URL || 'https://app.sim.ai'
        const endpoint = `${appUrl}/api/workflows/${workflowId}/execute`
        const apiKeyPlaceholder = '$SIM_API_KEY'
        
        // Get input format example (returns empty string if no inputs, or -d flag with example data)
        const inputExample = getInputFormatExample(false)
        
        // Match the exact format from deploy modal
        const curlCommand = `curl -X POST -H "X-API-Key: ${apiKeyPlaceholder}" -H "Content-Type: application/json"${inputExample} ${endpoint}`

        successMessage = 'Workflow deployed successfully. You can now call it via the API.'
        
        resultData = {
          ...resultData,
          endpoint,
          curlCommand,
          apiKeyPlaceholder,
        }
      } else {
        successMessage = 'Workflow undeployed successfully.'
      }

      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, successMessage, resultData)

      // Refresh the workflow registry to update deployment status
      try {
        const setDeploymentStatus = useWorkflowRegistry.getState().setDeploymentStatus
        if (action === 'deploy') {
          setDeploymentStatus(
            workflowId,
            true,
            json.deployedAt ? new Date(json.deployedAt) : undefined,
            json.apiKey || ''
          )
        } else {
          setDeploymentStatus(workflowId, false, undefined, '')
        }
        const actionPast = action === 'undeploy' ? 'undeployed' : 'deployed'
        logger.info(`Workflow ${actionPast} and registry updated`)
      } catch (error) {
        logger.warn('Failed to update workflow registry:', error)
      }
    } catch (e: any) {
      logger.error('Deploy/undeploy failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to deploy/undeploy workflow')
    }
  }

  async execute(args?: DeployWorkflowArgs): Promise<void> {
    await this.handleAccept(args)
  }
}

