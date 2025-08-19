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
} from '@/lib/copilot/tools/types'

export abstract class BaseTool implements Tool {
  // Static property for tool ID - must be overridden by each tool
  static readonly id: string

  // Instance property for metadata
  abstract metadata: ToolMetadata

  /**
   * Notify the backend about the tool state change
   * Deprecated: previously called /api/copilot/confirm (Redis-backed). Now a no-op.
   */
  protected async notify(
    toolCallId: string,
    state: ToolState,
    message?: string
  ): Promise<ToolConfirmResponse> {
    return { success: true, message }
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
      run: 'executing',
      skip: 'rejected',
      background: 'background',
    }

    const newState = actionToState[action]

    // Update state locally
    options?.onStateChange?.(newState)

    // Special handling for run action
    if (action === 'run') {
      await this.execute(toolCall, options)
    } else {
      // Skip/background are now UI-only; no server-side confirmation
      await this.notify(toolCall.id, newState)

      // Additionally, when skipping, notify the agent via methods route (complete-tool)
      if (action === 'skip') {
        try {
          await fetch('/api/copilot/methods', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              methodId: 'no_op',
              params: { confirmationMessage: `User skipped tool: ${toolCall.name}` },
              toolCallId: toolCall.id,
              toolId: toolCall.id,
            }),
          })
        } catch (e) {
          // Swallow errors; skip should not break UI
        }
      }
    }
  }
}
