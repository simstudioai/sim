import type { BaseClientToolMetadata } from '@/lib/copilot/tools/client/base-tool'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'

export interface ToolExecutionContext {
  toolCallId: string
  toolName: string
  // Logging only; tools must not mutate store state directly
  log: (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    extra?: Record<string, any>
  ) => void
}

export interface ToolRunResult {
  status: number
  message?: any
  data?: any
}

export interface ClientToolDefinition<Args = any> {
  name: string
  metadata?: BaseClientToolMetadata
  // Return true if this tool requires user confirmation before execution
  hasInterrupt?: boolean | ((args?: Args) => boolean)
  // Main execution entry point. Returns a result for the store to handle.
  execute: (ctx: ToolExecutionContext, args?: Args) => Promise<ToolRunResult | undefined>
  // Optional accept/reject handlers for interrupt flows
  accept?: (ctx: ToolExecutionContext, args?: Args) => Promise<ToolRunResult | undefined>
  reject?: (ctx: ToolExecutionContext, args?: Args) => Promise<ToolRunResult | undefined>
}

export { ClientToolCallState }
