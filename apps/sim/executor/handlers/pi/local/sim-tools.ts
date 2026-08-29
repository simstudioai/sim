/**
 * Adapts user-selected Sim tools into backend-neutral {@link PiToolSpec}s that
 * Pi can call in Local Dev. Each spec carries the tool's JSON-schema parameters
 * and an `execute` that runs the real Sim tool through `executeTool`, so the
 * agent's calls go through the same credential-access checks as any block.
 *
 * MCP and custom tools are skipped in v1; block/integration tools are supported.
 */

import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  readWorkflowInputFieldsForTool,
  readWorkflowMetadataForTool,
} from '@/lib/internal/workflows/read-tool-enrichment'
import { resolveCustomBlockToolBinding } from '@/lib/workflows/custom-blocks/operations'
import { getAllBlocks } from '@/blocks/registry'
import type { ToolInput } from '@/executor/handlers/agent/types'
import type { PiToolResult, PiToolSpec } from '@/executor/handlers/pi/core/backend'
import type { ExecutionContext } from '@/executor/types'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { annotateDuplicateToolBindings } from '@/executor/utils/tool-binding-labels'
import { assignProviderToolIdentities } from '@/providers/tool-identity'
import type { ProviderToolConfig } from '@/providers/types'
import { transformBlockTool } from '@/providers/utils'
import { executeTool } from '@/tools'
import { mergeToolParameters } from '@/tools/merge-params'
import { ToolSchemaEnrichmentError } from '@/tools/params'
import type { ToolResponse } from '@/tools/types'
import { getTool } from '@/tools/utils'
import { getToolAsync } from '@/tools/utils.server'

const logger = createLogger('PiSimTools')
const TOOL_RESULT_UNAVAILABLE_MESSAGE =
  'Tool execution settled, but its result could not be returned safely. Do not retry a mutation automatically.'
const TOOL_EXECUTION_FAILED_MESSAGE = 'Tool execution failed'

function unavailableToolResult(): PiToolResult {
  return {
    text: TOOL_RESULT_UNAVAILABLE_MESSAGE,
    isError: true,
  }
}

type PiToolResultProjection =
  | { safe: true; result: PiToolResult }
  | { safe: false; result: PiToolResult }

export interface PiFunctionToolCostAccumulator {
  total: number
}

function projectToolResult(
  result: ToolResponse,
  registry: ResolvedSecretTraceRegistry | undefined
): PiToolResultProjection {
  try {
    if (!registry) {
      if (!result.success) {
        return {
          safe: true,
          result: {
            text: result.error || TOOL_EXECUTION_FAILED_MESSAGE,
            isError: true,
          },
        }
      }

      const text =
        typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? {})
      return typeof text === 'string'
        ? { safe: true, result: { text, isError: false } }
        : { safe: false, result: unavailableToolResult() }
    }

    if (result.success) {
      const projection = projectResolvedSecretModelContent(result.output, registry)
      if (!projection.safe) {
        return { safe: false, result: unavailableToolResult() }
      }

      const text =
        typeof projection.value === 'string'
          ? projection.value
          : JSON.stringify(projection.value ?? {})
      return typeof text === 'string'
        ? { safe: true, result: { text, isError: false } }
        : { safe: false, result: unavailableToolResult() }
    }

    if (!result.error) {
      return registry.isComplete()
        ? {
            safe: true,
            result: { text: TOOL_EXECUTION_FAILED_MESSAGE, isError: true },
          }
        : { safe: false, result: unavailableToolResult() }
    }

    const projection = projectResolvedSecretModelContent(result.error, registry)
    return projection.safe && typeof projection.value === 'string'
      ? { safe: true, result: { text: projection.value, isError: true } }
      : { safe: false, result: unavailableToolResult() }
  } catch {
    return { safe: false, result: unavailableToolResult() }
  }
}

function buildSimToolSpec(
  ctx: ExecutionContext,
  inputTools: ToolInput[],
  provider: ProviderToolConfig,
  toolIndex: number,
  functionToolCost?: PiFunctionToolCostAccumulator
): PiToolSpec {
  const toolId = provider.canonicalId ?? provider.id
  const preseededParams = provider.params || {}

  return {
    name: provider.id,
    description: provider.description || '',
    parameters: (provider.parameters as Record<string, unknown>) || {
      type: 'object',
      properties: {},
    },
    execute: async (args) => {
      const params = mergeToolParameters(preseededParams, args as Record<string, unknown>)
      const registry = ctx.resolvedSecretTraceRegistry
      const sourcePath = ['tools', String(toolIndex), 'params'] as const
      const toolCallRegistry = registry?.forkForInputPaths([sourcePath], {
        propagated: true,
      })
      if (toolCallRegistry && !toolCallRegistry.isComplete()) {
        return unavailableToolResult()
      }

      if (toolCallRegistry) {
        const inputProjection = toolCallRegistry.projectResolvedInputSelection({
          tools: inputTools,
        })
        const projectedTool = inputProjection.complete
          ? (inputProjection.value.tools as ToolInput[] | undefined)?.[toolIndex]
          : undefined
        if (!inputProjection.complete || !projectedTool) {
          return unavailableToolResult()
        }
        const projectedParams = mergeToolParameters(
          projectedTool.params || {},
          args as Record<string, unknown>
        )
        toolCallRegistry.recordTransformedInputProjection(params, projectedParams)
        if (!toolCallRegistry.isComplete()) return unavailableToolResult()
      }

      try {
        const result = await executeTool(
          toolId,
          {
            // User-preseeded values win over model arguments, and inputMapping is deep-merged.
            ...params,
            // Trusted execution context is written last so model arguments cannot override it.
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
          {
            executionContext: ctx,
            resolvedSecretTraceRegistry: toolCallRegistry,
          }
        )
        const resultCost = result.output?.cost
        const resultCostTotal =
          resultCost && typeof resultCost === 'object'
            ? (resultCost as Record<string, unknown>).total
            : undefined
        if (
          toolId === 'function_execute' &&
          result.success &&
          functionToolCost &&
          typeof resultCostTotal === 'number' &&
          Number.isFinite(resultCostTotal) &&
          resultCostTotal > 0
        ) {
          functionToolCost.total += resultCostTotal
        }
        const projection = projectToolResult(result, toolCallRegistry?.forkForPropagatedEntries())
        if (projection.safe && registry && toolCallRegistry?.isComplete()) {
          registry.mergeToolCallRegistry(toolCallRegistry)
        }
        return projection.result
      } catch (error) {
        const projection = projectToolResult(
          {
            success: false,
            output: {},
            error: getErrorMessage(error, 'Tool execution failed'),
          },
          toolCallRegistry?.forkForPropagatedEntries()
        )
        if (projection.safe && registry && toolCallRegistry?.isComplete()) {
          registry.mergeToolCallRegistry(toolCallRegistry)
        }
        return projection.result
      }
    },
  }
}

/**
 * Builds the Sim tool specs exposed to Pi for a local run. Only tools the user
 * added to the block are included, and `usageControl: 'none'` tools are dropped.
 */
export async function buildSimToolSpecs(
  ctx: ExecutionContext,
  inputTools: unknown,
  functionToolCost?: PiFunctionToolCostAccumulator
): Promise<PiToolSpec[]> {
  if (!Array.isArray(inputTools)) return []

  const configuredTools: Array<{ provider: ProviderToolConfig; toolIndex: number }> = []

  for (const [toolIndex, tool] of (inputTools as ToolInput[]).entries()) {
    if ((tool.usageControl || 'auto') === 'none') continue
    if (!tool.type || tool.type === 'mcp' || tool.type === 'custom-tool') continue

    try {
      const provider = await transformBlockTool(tool, {
        selectedOperation: tool.operation,
        getAllBlocks,
        getTool,
        getToolAsync,
        enrichmentContext: {
          workflowId: ctx.workflowId,
          workspaceId: ctx.workspaceId,
          executionId: ctx.executionId,
          userId: ctx.userId,
          executorDelegationOrigin: ctx.executorDelegationOrigin,
        },
        resolveCustomBlockBinding: (blockType: string) =>
          resolveCustomBlockToolBinding(blockType, ctx.workspaceId),
        readWorkflowInputFields: readWorkflowInputFieldsForTool,
        readWorkflowMetadata: readWorkflowMetadataForTool,
      })

      if (!provider?.id) continue
      configuredTools.push({ provider, toolIndex })
    } catch (error) {
      if (error instanceof ToolSchemaEnrichmentError) throw error
      logger.warn('Failed to adapt Sim tool for Pi', {
        type: tool.type,
        error: getErrorMessage(error),
      })
    }
  }

  const providers = configuredTools.map(({ provider }) => provider)
  await annotateDuplicateToolBindings(ctx, providers)
  assignProviderToolIdentities(providers)
  return configuredTools.map(({ provider, toolIndex }) =>
    buildSimToolSpec(ctx, inputTools, provider, toolIndex, functionToolCost)
  )
}
