import type { McpToolCall, McpToolResult } from '@/lib/mcp/types'

/**
 * Context passed through the Resilience Pipeline
 */
export interface McpExecutionContext {
  toolCall: McpToolCall
  serverId: string
  userId: string
  workspaceId: string
  /**
   * Additional parameters passed directly by the executeTool caller
   */
  extraHeaders?: Record<string, string>
}

/**
 * Standardized function signature for invoking the NEXT component in the pipeline
 */
export type McpMiddlewareNext = (context: McpExecutionContext) => Promise<McpToolResult>

/**
 * Interface that all Resilience Middlewares must implement
 */
export interface McpMiddleware {
  /**
   * Execute the middleware logic
   * @param context The current execution context
   * @param next The next middleware/tool in the chain
   */
  execute(context: McpExecutionContext, next: McpMiddlewareNext): Promise<McpToolResult>
}
