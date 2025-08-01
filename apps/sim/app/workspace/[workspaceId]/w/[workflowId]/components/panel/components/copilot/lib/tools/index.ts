/**
 * Copilot Tools Library
 * Export the public API for the tools system
 */

// Core types and interfaces
export type {
  Tool,
  ToolCall,
  ToolState,
  ToolMetadata,
  ToolSchema,
  ToolDisplayConfig,
  StateDisplayConfig,
  ToolExecuteResult,
  ToolConfirmResponse,
  ToolExecutionOptions,
} from './types'

// Base classes
export { BaseTool } from './base-tool'

// Registry
export { toolRegistry, ToolRegistry } from './registry'

// Client tool implementations
export { SetEnvironmentVariablesTool } from './client-tools/set-environment-variables'
export { RunWorkflowTool } from './client-tools/run-workflow'

// Server tool definitions
export { SERVER_TOOL_IDS, SERVER_TOOL_METADATA } from './server-tools/definitions'
export type { ServerToolId } from './server-tools/definitions'

// Utilities
export {
  getToolDisplayName,
  getToolIcon,
  getToolStateClasses,
  renderToolStateIcon,
  toolRequiresConfirmation,
  toolRequiresInterrupt,
  executeToolWithStateManagement,
  createToolActionButton,
  type ToolConfirmationProps,
} from './utils'

// React components
export { ToolConfirmation } from './tool-confirmation'
export { InlineToolCall } from './inline-tool-call' 