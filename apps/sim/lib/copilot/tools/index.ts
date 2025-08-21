/**
 * Copilot Tools Library (legacy)
 * Minimal exports retained for server tool metadata and types.
 */

// Registry (legacy) - retained only if other parts still read server metadata
export { ToolRegistry, toolRegistry } from './registry'
export type { ServerToolId } from './server-tools/definitions'
// Server tool definitions (display metadata used by store fallback)
export { SERVER_TOOL_IDS, SERVER_TOOL_METADATA } from './server-tools/definitions'
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
