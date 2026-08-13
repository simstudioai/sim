import { AsyncLocalStorage } from 'node:async_hooks'
import { getErrorMessage } from '@sim/utils/errors'
import { projectToolResultForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import type { ToolExecutionResult } from '@/lib/copilot/tool-executor/types'
import type { ExecutionContext } from '@/executor/types'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { getPreparedProviderToolInputProvenance } from '@/providers/tool-input-provenance'
import { type ExecuteToolOptions, executeTool } from '@/tools'
import type { ToolResponse } from '@/tools/types'

export interface ProviderRuntimeContext {
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  /** Trusted server execution context inherited by model-emitted tool calls. */
  executionContext?: ExecutionContext
}

export type ExecuteProviderToolOptions = ExecuteToolOptions

export interface ProviderToolExecutionResult {
  /** Original tool response retained for workflow outputs, traces, costs, files, and resources. */
  rawResponse: ToolResponse
  /** Copy safe to serialize into the next model request. */
  modelResponse: ToolResponse
}

const providerRuntimeContext = new AsyncLocalStorage<ProviderRuntimeContext | undefined>()

export function runWithProviderRuntimeContext<T>(
  context: ProviderRuntimeContext | undefined,
  callback: () => T
): T {
  return providerRuntimeContext.run(context, callback)
}

function toProviderModelResponse(
  rawResponse: ToolResponse,
  projectedResponse: ToolExecutionResult
): ToolResponse {
  const { output: _output, error: _error, ...functionalFields } = rawResponse
  return {
    ...functionalFields,
    output: Object.hasOwn(projectedResponse, 'output')
      ? (projectedResponse.output as ToolResponse['output'])
      : {},
    ...(projectedResponse.error !== undefined ? { error: projectedResponse.error } : {}),
  }
}

export async function executeProviderTool(
  toolId: string,
  params: Parameters<typeof executeTool>[1],
  options: ExecuteProviderToolOptions = {}
): Promise<ProviderToolExecutionResult> {
  const runtimeContext = providerRuntimeContext.getStore()
  const registry =
    options.resolvedSecretTraceRegistry ?? runtimeContext?.resolvedSecretTraceRegistry

  if (runtimeContext && !registry) {
    const response: ToolResponse = { success: false, output: {} }
    return { rawResponse: response, modelResponse: response }
  }
  const preparedInputProvenance = getPreparedProviderToolInputProvenance(params)
  const toolCallRegistry = registry
    ? preparedInputProvenance
      ? preparedInputProvenance.registry.forkForInputPaths(preparedInputProvenance.inputPaths, {
          propagated: true,
        })
      : runtimeContext
        ? registry.forkForInputPaths([])
        : registry.forkForToolCall()
    : undefined

  try {
    const executionContext = options.executionContext ?? runtimeContext?.executionContext
    const result = await executeTool(toolId, params, {
      ...options,
      ...(executionContext ? { executionContext } : {}),
      resolvedSecretTraceRegistry: toolCallRegistry,
    })
    if (!registry || !toolCallRegistry) {
      return { rawResponse: result, modelResponse: result }
    }

    const modelResponse = toProviderModelResponse(
      result,
      projectToolResultForCopilot(result, toolCallRegistry)
    )
    registry.mergeToolCallRegistry(toolCallRegistry)
    return { rawResponse: result, modelResponse }
  } catch (error) {
    if (!registry || !toolCallRegistry) throw error
    const errorName =
      error && typeof error === 'object' && 'name' in error ? String(error.name) : undefined
    registry.mergeToolCallRegistry(toolCallRegistry)
    if (errorName === 'AbortError' || errorName === 'APIUserAbortError') {
      throw error
    }
    const rawResponse: ToolResponse = {
      success: false,
      output: {},
      error: getErrorMessage(error),
    }
    const modelResponse = toProviderModelResponse(
      rawResponse,
      projectToolResultForCopilot(rawResponse, toolCallRegistry)
    )
    return { rawResponse, modelResponse }
  }
}
