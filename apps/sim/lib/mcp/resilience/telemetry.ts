import { createLogger } from '@sim/logger'
import type { McpToolResult } from '@/lib/mcp/types'
import type { McpExecutionContext, McpMiddleware, McpMiddlewareNext } from './types'

const logger = createLogger('mcp:telemetry')

export class TelemetryMiddleware implements McpMiddleware {
  async execute(context: McpExecutionContext, next: McpMiddlewareNext): Promise<McpToolResult> {
    const startTime = performance.now()

    try {
      const result = await next(context)

      const latency_ms = Math.round(performance.now() - startTime)
      const isError = result.isError === true

      logger.info('MCP Tool Execution Completed', {
        toolName: context.toolCall.name,
        serverId: context.serverId,
        workspaceId: context.workspaceId,
        latency_ms,
        success: !isError,
        ...(isError && { failure_reason: 'TOOL_ERROR' }),
      })

      return result
    } catch (error) {
      const latency_ms = Math.round(performance.now() - startTime)

      // Attempt to determine failure reason based on error
      let failure_reason = 'API_500' // General failure fallback
      if (error instanceof Error) {
        const lowerMsg = error.message.toLowerCase()
        if (error.name === 'TimeoutError' || lowerMsg.includes('timeout')) {
          failure_reason = 'TIMEOUT'
        } else if (lowerMsg.includes('validation') || error.name === 'ZodError') {
          failure_reason = 'VALIDATION_ERROR'
        }
      }

      logger.error('MCP Tool Execution Failed', {
        toolName: context.toolCall.name,
        serverId: context.serverId,
        workspaceId: context.workspaceId,
        latency_ms,
        failure_reason,
        err: error instanceof Error ? error.message : String(error),
      })

      throw error // Re-throw to allow upstream handling (e.g. circuit breaker)
    }
  }
}
