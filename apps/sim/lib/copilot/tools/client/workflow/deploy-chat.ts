import { Loader2, MessageSquare, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'
import { useCopilotStore } from '@/stores/panel/copilot/store'

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

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}

// Register UI config at module load
registerToolUIConfig(DeployChatClientTool.id, DeployChatClientTool.metadata.uiConfig!)
