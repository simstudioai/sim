/**
 * Copilot Tools Library
 * Export the public API for the tools system
 */

// Base classes
export { BaseTool } from './base-tool'
// Client tool implementations
export { RunWorkflowTool } from './client-tools/run-workflow'
export { InlineToolCall } from './inline-tool-call'
// Registry
export { ToolRegistry, toolRegistry } from './registry'
export type { ServerToolId } from './server-tools/definitions'
// Server tool definitions
export { SERVER_TOOL_IDS, SERVER_TOOL_METADATA } from './server-tools/definitions'
// React components
export { ToolConfirmation } from './tool-confirmation'
// Core types and interfaces
export type {
  CopilotToolCall,
  StateDisplayConfig,
  Tool,
  ToolConfirmResponse,
  ToolDisplayConfig,
  ToolExecuteResult,
  ToolExecutionOptions,
  ToolMetadata,
  ToolSchema,
  ToolState,
} from './types'
// Utilities
export {
  createToolActionButton,
  executeToolWithStateManagement,
  getToolDisplayName,
  getToolIcon,
  getToolStateClasses,
  renderToolStateIcon,
  type ToolConfirmationProps,
  toolRequiresConfirmation,
  toolRequiresInterrupt,
} from './utils'
