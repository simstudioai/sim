import { createLogger } from '@sim/logger'
import { Loader2, MessageSquare, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'
import { useCopilotStore } from '@/stores/panel/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export type ChatAuthType = 'public' | 'password' | 'email' | 'sso'

export interface OutputConfig {
  blockId: string
  path: string
}

export interface DeployChatArgs {
  action: 'deploy' | 'undeploy'
  workflowId?: string
  /** URL slug for the chat (lowercase letters, numbers, hyphens only) */
  identifier?: string
  /** Display title for the chat interface */
  title?: string
  /** Optional description */
  description?: string
  /** Authentication type: public, password, email, or sso */
  authType?: ChatAuthType
  /** Password for password-protected chats */
  password?: string
  /** List of allowed emails/domains for email or SSO auth */
  allowedEmails?: string[]
  /** Welcome message shown to users */
  welcomeMessage?: string
  /** Output configurations specifying which block outputs to display in chat */
  outputConfigs?: OutputConfig[]
}

/**
 * Deploy Chat tool for deploying workflows as chat interfaces.
 * This tool handles deploying workflows with chat-specific configuration
 * including authentication, customization, and output selection.
 */
export class DeployChatClientTool extends BaseClientTool {
  static readonly id = 'deploy_chat'

  constructor(toolCallId: string) {
    super(toolCallId, DeployChatClientTool.id, DeployChatClientTool.metadata)
  }

  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    const toolCallsById = useCopilotStore.getState().toolCallsById
    const toolCall = toolCallsById[this.toolCallId]
    const params = toolCall?.params as DeployChatArgs | undefined

    const action = params?.action || 'deploy'
    const buttonText = action === 'undeploy' ? 'Undeploy' : 'Deploy Chat'

    return {
      accept: { text: buttonText, icon: MessageSquare },
      reject: { text: 'Skip', icon: XCircle },
    }
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Preparing to deploy chat',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Deploy as chat?', icon: MessageSquare },
      [ClientToolCallState.executing]: { text: 'Deploying chat', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Deployed chat', icon: MessageSquare },
      [ClientToolCallState.error]: { text: 'Failed to deploy chat', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted deploying chat',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped deploying chat',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Deploy Chat', icon: MessageSquare },
      reject: { text: 'Skip', icon: XCircle },
    },
    uiConfig: {
      isSpecial: true,
      interrupt: {
        accept: { text: 'Deploy Chat', icon: MessageSquare },
        reject: { text: 'Skip', icon: XCircle },
        showAllowOnce: true,
        showAllowAlways: true,
      },
    },
    getDynamicText: (params, state) => {
      const action = params?.action === 'undeploy' ? 'undeploy' : 'deploy'

      switch (state) {
        case ClientToolCallState.success:
          return action === 'undeploy' ? 'Chat undeployed' : 'Chat deployed'
        case ClientToolCallState.executing:
          return action === 'undeploy' ? 'Undeploying chat' : 'Deploying chat'
        case ClientToolCallState.generating:
          return `Preparing to ${action} chat`
        case ClientToolCallState.pending:
          return action === 'undeploy' ? 'Undeploy chat?' : 'Deploy as chat?'
        case ClientToolCallState.error:
          return `Failed to ${action} chat`
        case ClientToolCallState.aborted:
          return action === 'undeploy' ? 'Aborted undeploying chat' : 'Aborted deploying chat'
        case ClientToolCallState.rejected:
          return action === 'undeploy' ? 'Skipped undeploying chat' : 'Skipped deploying chat'
      }
      return undefined
    },
  }

  /**
   * Generates a default identifier from the workflow name
   */
  private generateIdentifier(workflowName: string): string {
    return workflowName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50)
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: DeployChatArgs): Promise<void> {
    const logger = createLogger('DeployChatClientTool')
    try {
      const action = args?.action || 'deploy'
      const { activeWorkflowId, workflows } = useWorkflowRegistry.getState()
      const workflowId = args?.workflowId || activeWorkflowId

      if (!workflowId) {
        throw new Error('No workflow ID provided')
      }

      const workflow = workflows[workflowId]

      // Handle undeploy action
      if (action === 'undeploy') {
        this.setState(ClientToolCallState.executing)

        // First get the chat deployment ID
        const statusRes = await fetch(`/api/workflows/${workflowId}/chat/status`)
        if (!statusRes.ok) {
          this.setState(ClientToolCallState.error)
          await this.markToolComplete(500, 'Failed to check chat deployment status', {
            success: false,
            action: 'undeploy',
            isDeployed: false,
            error: 'Failed to check chat deployment status',
            errorCode: 'SERVER_ERROR',
          })
          return
        }

        const statusJson = await statusRes.json()
        if (!statusJson.isDeployed || !statusJson.deployment?.id) {
          this.setState(ClientToolCallState.error)
          await this.markToolComplete(400, 'No active chat deployment found for this workflow', {
            success: false,
            action: 'undeploy',
            isDeployed: false,
            error: 'No active chat deployment found for this workflow',
            errorCode: 'VALIDATION_ERROR',
          })
          return
        }

        const chatId = statusJson.deployment.id

        // Delete the chat deployment
        const res = await fetch(`/api/chat/manage/${chatId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        })

        if (!res.ok) {
          const txt = await res.text().catch(() => '')
          this.setState(ClientToolCallState.error)
          await this.markToolComplete(res.status, txt || `Server error (${res.status})`, {
            success: false,
            action: 'undeploy',
            isDeployed: true,
            error: txt || 'Failed to undeploy chat',
            errorCode: 'SERVER_ERROR',
          })
          return
        }

        this.setState(ClientToolCallState.success)
        await this.markToolComplete(200, 'Chat deployment removed successfully.', {
          success: true,
          action: 'undeploy',
          isDeployed: false,
        })
        return
      }

      this.setState(ClientToolCallState.executing)

      const statusRes = await fetch(`/api/workflows/${workflowId}/chat/status`)
      const statusJson = statusRes.ok ? await statusRes.json() : null
      const existingDeployment = statusJson?.deployment || null

      const baseIdentifier =
        existingDeployment?.identifier || this.generateIdentifier(workflow?.name || 'chat')
      const baseTitle = existingDeployment?.title || workflow?.name || 'Chat'
      const baseDescription = existingDeployment?.description || ''
      const baseAuthType = existingDeployment?.authType || 'public'
      const baseWelcomeMessage =
        existingDeployment?.customizations?.welcomeMessage || 'Hi there! How can I help you today?'
      const basePrimaryColor =
        existingDeployment?.customizations?.primaryColor || 'var(--brand-primary-hover-hex)'
      const baseAllowedEmails = Array.isArray(existingDeployment?.allowedEmails)
        ? existingDeployment.allowedEmails
        : []
      const baseOutputConfigs = Array.isArray(existingDeployment?.outputConfigs)
        ? existingDeployment.outputConfigs
        : []

      const identifier = args?.identifier || baseIdentifier
      const title = args?.title || baseTitle
      const description = args?.description ?? baseDescription
      const authType = args?.authType || baseAuthType
      const welcomeMessage = args?.welcomeMessage || baseWelcomeMessage
      const outputConfigs = args?.outputConfigs || baseOutputConfigs
      const allowedEmails = args?.allowedEmails || baseAllowedEmails
      const primaryColor = basePrimaryColor

      if (!identifier || !title) {
        throw new Error('Chat identifier and title are required')
      }

      if (authType === 'password' && !args?.password && !existingDeployment?.hasPassword) {
        throw new Error('Password is required when using password protection')
      }

      if ((authType === 'email' || authType === 'sso') && allowedEmails.length === 0) {
        throw new Error(`At least one email or domain is required when using ${authType} access`)
      }

      const payload = {
        workflowId,
        identifier: identifier.trim(),
        title: title.trim(),
        description: description.trim(),
        customizations: {
          primaryColor,
          welcomeMessage: welcomeMessage.trim(),
        },
        authType,
        password: authType === 'password' ? args?.password : undefined,
        allowedEmails: authType === 'email' || authType === 'sso' ? allowedEmails : [],
        outputConfigs,
      }

      const isUpdating = Boolean(existingDeployment?.id)
      const endpoint = isUpdating ? `/api/chat/manage/${existingDeployment.id}` : '/api/chat'
      const method = isUpdating ? 'PATCH' : 'POST'

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const json = await res.json()

      if (!res.ok) {
        if (json.error === 'Identifier already in use') {
          this.setState(ClientToolCallState.error)
          await this.markToolComplete(
            400,
            `The identifier "${identifier}" is already in use. Please choose a different one.`,
            {
              success: false,
              action: 'deploy',
              isDeployed: false,
              identifier,
              error: `Identifier "${identifier}" is already taken`,
              errorCode: 'IDENTIFIER_TAKEN',
            }
          )
          return
        }

        // Handle validation errors
        if (json.code === 'VALIDATION_ERROR') {
          this.setState(ClientToolCallState.error)
          await this.markToolComplete(400, json.error || 'Validation error', {
            success: false,
            action: 'deploy',
            isDeployed: false,
            error: json.error,
            errorCode: 'VALIDATION_ERROR',
          })
          return
        }

        this.setState(ClientToolCallState.error)
        await this.markToolComplete(res.status, json.error || 'Failed to deploy chat', {
          success: false,
          action: 'deploy',
          isDeployed: false,
          error: json.error || 'Server error',
          errorCode: 'SERVER_ERROR',
        })
        return
      }

      if (!json.chatUrl) {
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(500, 'Response missing chat URL', {
          success: false,
          action: 'deploy',
          isDeployed: false,
          error: 'Response missing chat URL',
          errorCode: 'SERVER_ERROR',
        })
        return
      }

      this.setState(ClientToolCallState.success)
      await this.markToolComplete(
        200,
        `Chat deployed successfully! Available at: ${json.chatUrl}`,
        {
          success: true,
          action: 'deploy',
          isDeployed: true,
          chatId: json.id,
          chatUrl: json.chatUrl,
          identifier,
          title,
          authType,
        }
      )

      // Update the workflow registry to reflect deployment status
      // Chat deployment also deploys the API, so we update the registry
      try {
        const setDeploymentStatus = useWorkflowRegistry.getState().setDeploymentStatus
        setDeploymentStatus(workflowId, true, new Date(), '')
        logger.info('Workflow deployment status updated in registry')
      } catch (error) {
        logger.warn('Failed to update workflow registry:', error)
      }

      logger.info('Chat deployed successfully:', json.chatUrl)
    } catch (e: any) {
      logger.error('Deploy chat failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to deploy chat', {
        success: false,
        action: 'deploy',
        isDeployed: false,
        error: e?.message || 'Failed to deploy chat',
        errorCode: 'SERVER_ERROR',
      })
    }
  }

  async execute(args?: DeployChatArgs): Promise<void> {
    await this.handleAccept(args)
  }
}

// Register UI config at module load
registerToolUIConfig(DeployChatClientTool.id, DeployChatClientTool.metadata.uiConfig!)
