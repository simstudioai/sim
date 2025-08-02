/**
 * Base class for all copilot tools
 */

import type {
  CopilotToolCall,
  Tool,
  ToolConfirmResponse,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
  ToolState,
} from './types'

export abstract class BaseTool implements Tool {
  // Static property for tool ID - must be overridden by each tool
  static readonly id: string

  // Instance property for metadata
  abstract metadata: ToolMetadata

  /**
   * Notify the backend about the tool state change
   */
  protected async notify(
    toolCallId: string,
    state: ToolState,
    message?: string
  ): Promise<ToolConfirmResponse> {
    try {
      // Map ToolState to NotificationStatus for API
      const notificationStatus = state === 'errored' ? 'error' : state

      const response = await fetch('/api/copilot/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          toolCallId,
          status: notificationStatus,
          message,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        console.error(`Failed to confirm tool ${toolCallId}:`, error)
        return { success: false, message: error.error || 'Failed to confirm tool' }
      }

      const result = await response.json()
      return { success: true, message: result.message }
    } catch (error) {
      console.error('Error confirming tool:', error)
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Execute the tool - must be implemented by each tool
   */
  abstract execute(
    toolCall: CopilotToolCall,
    options?: ToolExecutionOptions
  ): Promise<ToolExecuteResult>

  /**
   * Get the display name for the current state
   */
  getDisplayName(toolCall: CopilotToolCall): string {
    const { state, parameters = {} } = toolCall
    const { displayConfig } = this.metadata

    // First try dynamic display name if available
    if (displayConfig.getDynamicDisplayName) {
      const dynamicName = displayConfig.getDynamicDisplayName(state, parameters)
      if (dynamicName) return dynamicName
    }

    // Then try state-specific display name
    const stateConfig = displayConfig.states[state]
    if (stateConfig?.displayName) {
      return stateConfig.displayName
    }

    // Fallback to a generic state name
    return `${this.metadata.id} (${state})`
  }

  /**
   * Get the icon for the current state
   */
  getIcon(toolCall: CopilotToolCall): string {
    const { state } = toolCall
    const stateConfig = this.metadata.displayConfig.states[state]

    // Return state-specific icon or default
    return stateConfig?.icon || 'default'
  }

  /**
   * Check if tool requires confirmation in current state
   */
  requiresConfirmation(toolCall: CopilotToolCall): boolean {
    // Only show confirmation UI if tool requires interrupt and is in pending state
    return this.metadata.requiresInterrupt && toolCall.state === 'pending'
  }

  /**
   * Handle user action (run/skip/background)
   */
  async handleUserAction(
    toolCall: CopilotToolCall,
    action: 'run' | 'skip' | 'background',
    options?: ToolExecutionOptions
  ): Promise<void> {
    // Map actions to states
    const actionToState: Record<string, ToolState> = {
      run: 'executing', // Changed from 'accepted' to 'executing'
      skip: 'rejected',
      background: 'background',
    }

    const newState = actionToState[action]

    // Update state locally
    options?.onStateChange?.(newState)

    // Special handling for run action
    if (action === 'run') {
      // Directly call execute method - no wrapper
      await this.execute(toolCall, options)
    } else {
      // For skip/background, just notify
      const message =
        action === 'skip'
          ? this.getDisplayName({ ...toolCall, state: 'rejected' })
          : 'The user moved execution to the background'

      await this.notify(toolCall.id, newState, message)
    }
  }
}
