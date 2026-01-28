/**
 * Server-side tool executor.
 *
 * This module provides the ability to execute tools server-side (in Next.js API routes)
 * rather than requiring the browser to execute them.
 *
 * Key function: executeToolOnServer()
 * - Returns ToolResult if the tool was executed server-side
 * - Returns null if the tool is not registered (client should handle)
 */

import { createLogger } from '@sim/logger'
import { executeRegisteredTool, isServerExecutedTool } from './registry'
import type { ExecutionContext, ToolResult } from './types'

const logger = createLogger('ServerExecutor')

/**
 * Execute a tool on the server if it's registered.
 *
 * @param toolName - The name of the tool to execute
 * @param args - The arguments to pass to the tool
 * @param context - Execution context (userId, workflowId, etc.)
 * @returns ToolResult if executed, null if tool not registered server-side
 */
export async function executeToolOnServer(
  toolName: string,
  args: unknown,
  context: ExecutionContext
): Promise<ToolResult | null> {
  // Check if this tool should be executed server-side
  if (!isServerExecutedTool(toolName)) {
    logger.debug('Tool not registered for server execution, client will handle', { toolName })
    return null
  }

  logger.info('Executing tool server-side', {
    toolName,
    userId: context.userId,
    workflowId: context.workflowId,
  })

  const startTime = Date.now()
  const result = await executeRegisteredTool(toolName, args, context)

  logger.info('Tool execution completed', {
    toolName,
    success: result.success,
    durationMs: Date.now() - startTime,
  })

  return result
}

export { isServerExecutedTool, SERVER_EXECUTED_TOOLS } from './registry'
// Re-export types and utilities
export type { ExecutionContext, ToolResult } from './types'
export { errorResult, successResult } from './types'
