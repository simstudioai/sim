import { Loader2, Navigation, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { useCopilotStore } from '@/stores/panel-new/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

type NavigationDestination = 'workflow' | 'new_workflow' | 'logs' | 'templates' | 'vector_db' | 'settings'

interface NavigateUIArgs {
  destination: NavigationDestination
  workflowName?: string
}

export class NavigateUIClientTool extends BaseClientTool {
  static readonly id = 'navigate_ui'

  constructor(toolCallId: string) {
    super(toolCallId, NavigateUIClientTool.id, NavigateUIClientTool.metadata)
  }

  /**
   * Override to provide dynamic button text based on destination
   */
  getInterruptDisplays(): BaseClientToolMetadata['interrupt'] | undefined {
    const toolCallsById = useCopilotStore.getState().toolCallsById
    const toolCall = toolCallsById[this.toolCallId]
    const params = toolCall?.params as NavigateUIArgs | undefined

    const destination = params?.destination
    const workflowName = params?.workflowName

    let buttonText = 'Navigate'
    
    if (destination === 'workflow' && workflowName) {
      buttonText = 'Open workflow'
    } else if (destination === 'new_workflow') {
      buttonText = 'Create workflow'
    } else if (destination === 'logs') {
      buttonText = 'Open logs'
    } else if (destination === 'templates') {
      buttonText = 'Open templates'
    } else if (destination === 'vector_db') {
      buttonText = 'Open vector DB'
    } else if (destination === 'settings') {
      buttonText = 'Open settings'
    }

    return {
      accept: { text: buttonText, icon: Navigation },
      reject: { text: 'Skip', icon: XCircle },
    }
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Preparing to open',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Open?', icon: Navigation },
      [ClientToolCallState.executing]: { text: 'Opening', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Opened', icon: Navigation },
      [ClientToolCallState.error]: { text: 'Failed to open', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted opening',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped opening',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Open', icon: Navigation },
      reject: { text: 'Skip', icon: XCircle },
    },
    getDynamicText: (params, state) => {
      const destination = params?.destination as NavigationDestination | undefined
      const workflowName = params?.workflowName

      let action = 'open'
      let actionCapitalized = 'Open'
      let actionPast = 'opened'
      let actionIng = 'opening'
      let target = ''

      if (destination === 'new_workflow') {
        action = 'create new workflow'
        actionCapitalized = 'Create new workflow'
        actionPast = 'created new workflow'
        actionIng = 'creating new workflow'
      } else if (destination === 'workflow' && workflowName) {
        target = ` workflow "${workflowName}"`
      } else if (destination === 'workflow') {
        target = ' workflows'
      } else if (destination === 'logs') {
        target = ' logs'
      } else if (destination === 'templates') {
        target = ' templates'
      } else if (destination === 'vector_db') {
        target = ' vector database'
      } else if (destination === 'settings') {
        target = ' settings'
      }

      const fullAction = destination === 'new_workflow' ? action : `${action}${target}`
      const fullActionCapitalized = destination === 'new_workflow' ? actionCapitalized : `${actionCapitalized}${target}`
      const fullActionPast = destination === 'new_workflow' ? actionPast : `${actionPast}${target}`
      const fullActionIng = destination === 'new_workflow' ? actionIng : `${actionIng}${target}`

      switch (state) {
        case ClientToolCallState.success:
          return fullActionPast.charAt(0).toUpperCase() + fullActionPast.slice(1)
        case ClientToolCallState.executing:
          return fullActionIng.charAt(0).toUpperCase() + fullActionIng.slice(1)
        case ClientToolCallState.generating:
          return `Preparing to ${fullAction}`
        case ClientToolCallState.pending:
          return `${fullActionCapitalized}?`
        case ClientToolCallState.error:
          return `Failed to ${fullAction}`
        case ClientToolCallState.aborted:
          return `Aborted ${fullAction}`
        case ClientToolCallState.rejected:
          return `Skipped ${fullAction}`
      }
      return undefined
    },
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: NavigateUIArgs): Promise<void> {
    const logger = createLogger('NavigateUIClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      const destination = args?.destination
      const workflowName = args?.workflowName

      if (!destination) {
        throw new Error('No destination provided')
      }

      let navigationUrl = ''
      let successMessage = ''

      // Get current workspace ID from URL
      const workspaceId = window.location.pathname.split('/')[2]

      switch (destination) {
        case 'workflow':
          if (workflowName) {
            // Find workflow by name
            const { workflows } = useWorkflowRegistry.getState()
            const workflow = Object.values(workflows).find(
              (w) => w.name.toLowerCase() === workflowName.toLowerCase()
            )

            if (!workflow) {
              throw new Error(`Workflow "${workflowName}" not found`)
            }

            navigationUrl = `/workspace/${workspaceId}/w/${workflow.id}`
            successMessage = `Navigated to workflow "${workflowName}"`
          } else {
            navigationUrl = `/workspace/${workspaceId}/w`
            successMessage = 'Navigated to workflows'
          }
          break

        case 'new_workflow':
          // Dispatch event to create new workflow
          window.dispatchEvent(new CustomEvent('create-workflow'))
          successMessage = 'Created new workflow'
          break

        case 'logs':
          navigationUrl = `/workspace/${workspaceId}/logs`
          successMessage = 'Navigated to logs'
          break

        case 'templates':
          navigationUrl = `/workspace/${workspaceId}/templates`
          successMessage = 'Navigated to templates'
          break

        case 'vector_db':
          navigationUrl = `/workspace/${workspaceId}/vector-db`
          successMessage = 'Navigated to vector database'
          break

        case 'settings':
          window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'general' } }))
          successMessage = 'Opened settings'
          break

        default:
          throw new Error(`Unknown destination: ${destination}`)
      }

      // Navigate if URL was set
      if (navigationUrl) {
        window.location.href = navigationUrl
      }

      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, successMessage, {
        destination,
        workflowName,
        navigated: true,
      })
    } catch (e: any) {
      logger.error('Navigation failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to navigate')
    }
  }

  async execute(args?: NavigateUIArgs): Promise<void> {
    await this.handleAccept(args)
  }
}

