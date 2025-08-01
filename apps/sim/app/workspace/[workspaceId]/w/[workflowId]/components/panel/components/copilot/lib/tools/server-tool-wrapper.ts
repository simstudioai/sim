/**
 * Server Tool Wrapper
 * Wraps server-side tools to work with the client-side tool interface
 */

import type { 
  Tool, 
  ToolCall, 
  ToolExecuteResult, 
  ToolMetadata, 
  ToolExecutionOptions,
  ToolState 
} from './types'

export class ServerToolWrapper implements Tool {
  constructor(public metadata: ToolMetadata) {}

  /**
   * Server tools don't execute on the client
   */
  async execute(toolCall: ToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult> {
    // Server tools are executed on the backend
    // This method should not be called for server tools
    return {
      success: true,
      data: { message: 'Server tool execution is handled by the backend' }
    }
  }

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
   * Server tools don't require confirmation - they're already executed
   */
  requiresConfirmation(toolCall: ToolCall): boolean {
    return false
  }

  /**
   * Server tools don't handle user actions
   */
  async handleUserAction(
    toolCall: ToolCall,
    action: 'run' | 'skip' | 'background',
    options?: ToolExecutionOptions
  ): Promise<void> {
    // Server tools don't handle user actions
    console.warn(`handleUserAction called on server tool ${this.metadata.id}`)
  }
} 