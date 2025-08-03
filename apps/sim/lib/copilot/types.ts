/**
 * Copilot Types - Consolidated from various locations
 * This file contains all copilot-related type definitions
 */

// Tool call state types (from apps/sim/types/tool-call.ts)
export interface ToolCallState {
  id: string
  name: string
  displayName?: string
  parameters?: Record<string, any>
  state:
    | 'detecting'
    | 'pending'
    | 'executing'
    | 'completed'
    | 'error'
    | 'rejected'
    | 'applied'
    | 'ready_for_review'
    | 'aborted'
    | 'skipped'
    | 'background'
  startTime?: number
  endTime?: number
  duration?: number
  result?: any
  error?: string
  progress?: string
}

export interface ToolCallGroup {
  id: string
  toolCalls: ToolCallState[]
  status: 'pending' | 'in_progress' | 'completed' | 'error'
  startTime?: number
  endTime?: number
  summary?: string
}

export interface InlineContent {
  type: 'text' | 'tool_call'
  content: string
  toolCall?: ToolCallState
}

export interface ParsedMessageContent {
  textContent: string
  toolCalls: ToolCallState[]
  toolGroups: ToolCallGroup[]
  inlineContent?: InlineContent[]
}

export interface ToolCallIndicator {
  type: 'status' | 'thinking' | 'execution'
  content: string
  toolNames?: string[]
}

// Copilot Tools Type Definitions (from workspace copilot lib)
import type { CopilotToolCall, ToolState } from '@/stores/copilot/types'

export type NotificationStatus =
  | 'pending'
  | 'success'
  | 'error'
  | 'accepted'
  | 'rejected'
  | 'background'

// Export the consolidated types
export type { CopilotToolCall, ToolState }

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
  allowBackgroundExecution?: boolean
  stateMessages?: Partial<Record<NotificationStatus, string>>
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
  execute(toolCall: CopilotToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult>

  // Get the display name for the current state
  getDisplayName(toolCall: CopilotToolCall): string

  // Get the icon for the current state
  getIcon(toolCall: CopilotToolCall): string

  // Handle user action (run/skip)
  handleUserAction(
    toolCall: CopilotToolCall,
    action: 'run' | 'skip' | 'background',
    options?: ToolExecutionOptions
  ): Promise<void>

  // Check if tool shows confirmation UI for current state
  requiresConfirmation(toolCall: CopilotToolCall): boolean
}
