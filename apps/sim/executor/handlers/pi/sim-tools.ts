/**
 * Adapts user-selected Sim tools into backend-neutral {@link PiToolSpec}s that
 * Pi can call in local mode. Each spec carries the tool's JSON-schema parameters
 * and an `execute` that runs the real Sim tool through `executeTool`, so the
 * agent's calls go through the same credential-access checks as any block.
 *
 * MCP and custom tools are skipped in v1; block/integration tools are supported.
 */

import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { getAllBlocks } from '@/blocks/registry'
import type { ToolInput } from '@/executor/handlers/agent/types'
import type { PiToolResult, PiToolSpec } from '@/executor/handlers/pi/backend'
import type { ExecutionContext } from '@/executor/types'
import { transformBlockTool } from '@/providers/utils'
import { executeTool } from '@/tools'
import type { ToolResponse } from '@/tools/types'
import { getTool } from '@/tools/utils'
import { getToolAsync } from '@/tools/utils.server'

const logger = createLogger('PiSimTools')

function toToolResult(result: ToolResponse): PiToolResult {
  if (result.success) {
    const text =
      typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? {})
    return { text, isError: false }
  }
  return { text: result.error || 'Tool execution failed', isError: true }
}

/**
 * Builds the Sim tool specs exposed to Pi for a local run. Only tools the user
 * added to the block are included, and `usageControl: 'none'` tools are dropped.
 */
export async function buildSimToolSpecs(
  ctx: ExecutionContext,
  inputTools: unknown
): Promise<PiToolSpec[]> {
  if (!Array.isArray(inputTools)) return []

  const specs: PiToolSpec[] = []

  for (const tool of inputTools as ToolInput[]) {
    if ((tool.usageControl || 'auto') === 'none') continue
    if (!tool.type || tool.type === 'mcp' || tool.type === 'custom-tool') continue

    try {
      const provider = await transformBlockTool(tool, {
        selectedOperation: tool.operation,
        getAllBlocks,
        getTool,
        getToolAsync,
      })

      if (!provider?.id) continue

      const toolId = provider.id
      const preseededParams = provider.params || {}

      specs.push({
        name: toolId,
        description: provider.description || '',
        parameters: (provider.parameters as Record<string, unknown>) || {
          type: 'object',
          properties: {},
        },
        execute: async (args) => {
          try {
            const result = await executeTool(
              toolId,
              {
                ...preseededParams,
                ...args,
                // Trusted execution context, spread last so an LLM-supplied
                // `_context` arg can't override it. executeTool reads this directly
                // for OAuth-credential resolution and internal-route identity, the
                // same way the Agent block's tool calls do.
                _context: {
                  workflowId: ctx.workflowId,
                  workspaceId: ctx.workspaceId,
                  executionId: ctx.executionId,
                  userId: ctx.userId,
                  isDeployedContext: ctx.isDeployedContext,
                  enforceCredentialAccess: ctx.enforceCredentialAccess,
                  callChain: ctx.callChain,
                },
              },
              { executionContext: ctx }
            )
            return toToolResult(result)
          } catch (error) {
            return { text: getErrorMessage(error, 'Tool execution failed'), isError: true }
          }
        },
      })
    } catch (error) {
      logger.warn('Failed to adapt Sim tool for Pi', {
        type: tool.type,
        error: getErrorMessage(error),
      })
    }
  }

  return specs
}
