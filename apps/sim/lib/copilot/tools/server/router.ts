/**
 * Server Tool Router
 *
 * This module provides backwards compatibility for the execute-copilot-server-tool API route.
 * It delegates to the new unified registry in server-executor/registry.ts
 *
 * @deprecated Use executeRegisteredTool from server-executor/registry.ts directly
 */

import { createLogger } from '@sim/logger'
import { executeRegisteredTool, isServerExecutedTool } from '@/lib/copilot/server-executor/registry'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'

const logger = createLogger('ServerToolRouter')

// Re-export for backwards compatibility
export { ExecuteResponseSuccessSchema }
export type ExecuteResponseSuccess = (typeof ExecuteResponseSuccessSchema)['_type']

/**
 * Route execution to the appropriate server tool.
 *
 * @deprecated Use executeRegisteredTool from server-executor/registry.ts directly
 */
export async function routeExecution(
  toolName: string,
  payload: unknown,
  context?: { userId: string }
): Promise<unknown> {
  if (!isServerExecutedTool(toolName)) {
    throw new Error(`Unknown server tool: ${toolName}`)
  }

  logger.debug('Routing to tool via unified registry', {
    toolName,
    payloadPreview: (() => {
      try {
        return JSON.stringify(payload).slice(0, 200)
      } catch {
        return undefined
      }
    })(),
  })

  const result = await executeRegisteredTool(toolName, payload, {
    userId: context?.userId ?? '',
  })

  // The old API expected the raw result, not wrapped in ToolResult
  // For backwards compatibility, unwrap and throw on error
  if (!result.success) {
    throw new Error(result.error?.message ?? 'Tool execution failed')
  }

  return result.data
}
