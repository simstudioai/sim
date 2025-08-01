/**
 * Base class for all copilot tools
 */

import type { 
  Tool, 
  ToolCall, 
  ToolConfirmResponse, 
  ToolExecuteResult, 
  ToolMetadata, 
  ToolState,
  ToolExecutionOptions 
} from './types'

export abstract class BaseTool implements Tool {
  // Static property for tool ID - must be overridden by each tool
  static readonly id: string

  // Instance property for metadata
  abstract metadata: ToolMetadata

  /**
   * Notify the backend about the tool state change
   */
  protected async notify(toolCallId: string, state: ToolState, message?: string): Promise<ToolConfirmResponse> {
    try {
      const response = await fetch('/api/copilot/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          toolCallId,
          status: state,
          message,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        console.error(`Failed to confirm tool ${toolCallId}:`, error)
        return { success: false, message: error.error || 'Failed to confirm tool' }
      }

      const result = await response.json()
      console.log(`Tool ${toolCallId} state updated to ${state}:`, result)
      return { success: true, message: result.message }
    } catch (error) {
      console.error('Error confirming tool:', error)
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Execute the tool - must be implemented by each tool
   */
  abstract execute(toolCall: ToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult>

  /**
   * Get the display name for the current state
   */
  getDisplayName(toolCall: ToolCall): string {
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
  getIcon(toolCall: ToolCall): string {
    const { state } = toolCall
    const stateConfig = this.metadata.displayConfig.states[state]
    
    // Return state-specific icon or default
    return stateConfig?.icon || 'default'
  }

  /**
   * Check if tool requires confirmation in current state
   */
  requiresConfirmation(toolCall: ToolCall): boolean {
    // Only show confirmation UI if tool requires interrupt and is in pending state
    return this.metadata.requiresInterrupt && toolCall.state === 'pending'
  }

  /**
   * Handle user action (run/skip/background)
   */
  async handleUserAction(
    toolCall: ToolCall,
    action: 'run' | 'skip' | 'background',
    options?: ToolExecutionOptions
  ): Promise<void> {
    // Map actions to states
    const actionToState: Record<string, ToolState> = {
      run: 'accepted',
      skip: 'rejected',
      background: 'background'
    }

    const newState = actionToState[action]
    
    // Update state locally
    options?.onStateChange?.(newState)

    // Special handling for run action
    if (action === 'run') {
      // First notify acceptance
      await this.notify(toolCall.id, 'accepted')
      
      // Then execute
      await this.executeWithStateManagement(toolCall, options)
    } else {
      // For skip/background, just notify
      const message = action === 'skip' 
        ? this.getDisplayName({ ...toolCall, state: 'rejected' })
        : 'The user moved execution to the background'
      
      await this.notify(toolCall.id, newState, message)
    }
  }

  /**
   * Execute with proper state management
   */
  protected async executeWithStateManagement(
    toolCall: ToolCall,
    options?: ToolExecutionOptions
  ): Promise<void> {
    // Update to executing state
    options?.onStateChange?.('executing')
    await this.notify(toolCall.id, 'executing')

    try {
      // Check pre-conditions if provided
      if (options?.beforeExecute) {
        const shouldContinue = await options.beforeExecute()
        if (!shouldContinue) {
          throw new Error('Pre-execution check failed')
        }
      }

      // Execute the tool
      const result = await this.execute(toolCall, options)

      // Handle post-execution if provided
      if (options?.afterExecute) {
        await options.afterExecute(result)
      }

      // Determine final state
      const finalState: ToolState = result.success ? 'success' : 'errored'
      
      // Update state and notify
      options?.onStateChange?.(finalState)
      await this.notify(
        toolCall.id,
        finalState,
        this.getDisplayName({ ...toolCall, state: finalState })
      )
    } catch (error) {
      console.error('Error during tool execution:', error)
      
      // Update to error state
      options?.onStateChange?.('errored')
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await this.notify(
        toolCall.id,
        'errored',
        `${this.getDisplayName({ ...toolCall, state: 'errored' })}: ${errorMessage}`
      )
    }
  }
} 