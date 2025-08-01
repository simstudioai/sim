/**
 * Copilot Tools Type Definitions
 * Clean architecture for client-side tool management
 */

// Tool states that a tool can be in
export type ToolState = 
  | 'pending'      // Waiting for user confirmation (shows Run/Skip buttons)
  | 'executing'    // Currently executing
  | 'success'      // Successfully completed
  | 'accepted'     // User accepted but not yet executed
  | 'rejected'     // User rejected/skipped
  | 'errored'      // Failed with error
  | 'background'   // Moved to background execution

// Tool call from the AI assistant
export interface ToolCall {
  id: string
  name: string
  state: ToolState
  parameters?: Record<string, any>
  error?: string | { message: string }
  timestamp?: string
}

// Display configuration for different states
export interface StateDisplayConfig {
  // Display name for this state (e.g., "Setting environment variables" for executing)
  displayName: string
  
  // Icon identifier for this state
  icon?: string
  
  // CSS classes or style hints
  className?: string
}

// Complete display configuration for a tool
export interface ToolDisplayConfig {
  // Display configurations for each state
  states: {
    [K in ToolState]?: StateDisplayConfig
  }
  
  // Optional function to generate dynamic display names based on parameters
  getDynamicDisplayName?: (state: ToolState, params: Record<string, any>) => string | null
}

// Schema for tool parameters (OpenAI function calling format)
export interface ToolSchema {
  name: string
  description: string
  parameters?: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
}

// Tool metadata - all the static configuration
export interface ToolMetadata {
  id: string
  displayConfig: ToolDisplayConfig
  schema: ToolSchema
  requiresInterrupt: boolean
}

// Result from executing a tool
export interface ToolExecuteResult {
  success: boolean
  data?: any
  error?: string
}

// Response from the confirmation API
export interface ToolConfirmResponse {
  success: boolean
  message?: string
}

// Options for tool execution
export interface ToolExecutionOptions {
  // Callback when state changes
  onStateChange?: (state: ToolState) => void
  
  // For tools that need special handling (like run_workflow)
  beforeExecute?: () => Promise<boolean>
  afterExecute?: (result: ToolExecuteResult) => Promise<void>
  
  // Custom context for execution
  context?: Record<string, any>
}

// The main tool interface that all tools must implement
export interface Tool {
  // Tool metadata
  metadata: ToolMetadata
  
  // Execute the tool
  execute(toolCall: ToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult>
  
  // Get the display name for the current state
  getDisplayName(toolCall: ToolCall): string
  
  // Get the icon for the current state
  getIcon(toolCall: ToolCall): string
  
  // Handle user action (run/skip)
  handleUserAction(
    toolCall: ToolCall, 
    action: 'run' | 'skip' | 'background',
    options?: ToolExecutionOptions
  ): Promise<void>
  
  // Check if tool shows confirmation UI for current state
  requiresConfirmation(toolCall: ToolCall): boolean
} 