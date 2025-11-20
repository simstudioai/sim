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

import type { ProviderId } from '@/providers/types'
// Copilot Tools Type Definitions (from workspace copilot lib)
import type { CopilotToolCall, ToolState } from '@/stores/panel-new/copilot/types'

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
  displayName: string
  icon?: string
  className?: string
}

// Complete display configuration for a tool
export interface ToolDisplayConfig {
  states: {
    [K in ToolState]?: StateDisplayConfig
  }
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
  onStateChange?: (state: ToolState) => void
  beforeExecute?: () => Promise<boolean>
  afterExecute?: (result: ToolExecuteResult) => Promise<void>
  context?: Record<string, any>
}

// The main tool interface that all tools must implement
export interface Tool {
  metadata: ToolMetadata
  execute(toolCall: CopilotToolCall, options?: ToolExecutionOptions): Promise<ToolExecuteResult>
  getDisplayName(toolCall: CopilotToolCall): string
  getIcon(toolCall: CopilotToolCall): string
  handleUserAction(
    toolCall: CopilotToolCall,
    action: 'run' | 'skip' | 'background',
    options?: ToolExecutionOptions
  ): Promise<void>
  requiresConfirmation(toolCall: CopilotToolCall): boolean
}

// Provider configuration for Sim Agent requests
// This type is only for the `provider` field in requests sent to the Sim Agent
export type CopilotProviderConfig =
  | {
      provider: 'azure-openai'
      model: string
      apiKey?: string
      apiVersion?: string
      endpoint?: string
    }
  | {
      provider: Exclude<ProviderId, 'azure-openai'>
      model?: string
      apiKey?: string
    }
