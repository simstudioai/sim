import { createLogger } from '@sim/logger'
import { Loader2, Rocket, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getInputFormatExample } from '@/lib/workflows/operations/deployment-utils'
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
      const logger = createLogger('DeployApiClientTool')
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

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: DeployApiArgs): Promise<void> {
    const logger = createLogger('DeployApiClientTool')
    try {
      const action = args?.action || 'deploy'
      const { activeWorkflowId, workflows } = useWorkflowRegistry.getState()
      const workflowId = args?.workflowId || activeWorkflowId

      if (!workflowId) {
        throw new Error('No workflow ID provided')
      }

      const workflow = workflows[workflowId]
      const workspaceId = workflow?.workspaceId

      // For deploy action, check if user has API keys first
      if (action === 'deploy') {
        if (!workspaceId) {
          throw new Error('Workflow workspace not found')
        }

        const hasKeys = await this.hasApiKeys(workspaceId)

        if (!hasKeys) {
          this.setState(ClientToolCallState.rejected)
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
        const appUrl = getBaseUrl()
        const apiEndpoint = `${appUrl}/api/workflows/${workflowId}/execute`
        const apiKeyPlaceholder = '$SIM_API_KEY'

        const inputExample = getInputFormatExample(false)
        const curlCommand = `curl -X POST -H "X-API-Key: ${apiKeyPlaceholder}" -H "Content-Type: application/json"${inputExample} ${apiEndpoint}`

        successMessage = 'Workflow deployed successfully as API. You can now call it via REST.'

        resultData = {
          ...resultData,
          endpoint: apiEndpoint,
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
        logger.info(`Workflow ${actionPast} as API and registry updated`)
      } catch (error) {
        logger.warn('Failed to update workflow registry:', error)
      }
    } catch (e: any) {
      logger.error('Deploy API failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to deploy API')
    }
  }

  async execute(args?: DeployApiArgs): Promise<void> {
    await this.handleAccept(args)
  }
}

// Register UI config at module load
registerToolUIConfig(DeployApiClientTool.id, DeployApiClientTool.metadata.uiConfig!)
