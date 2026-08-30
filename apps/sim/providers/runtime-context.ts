import { AsyncLocalStorage } from 'node:async_hooks'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike, omit } from '@sim/utils/object'
import { projectToolResultForCopilot } from '@/lib/mothership/request/tools/resolved-secret-result'
import type { ToolExecutionResult } from '@/lib/mothership/tool-executor/types'
import {
  CHILD_EXECUTION_ID_OUTPUT_KEY,
  CHILD_TRACE_DISABLED_OUTPUT_KEY,
} from '@/executor/constants'
import type { ExecutionContext } from '@/executor/types'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { getPreparedProviderToolInputProvenance } from '@/providers/tool-input-provenance'
import { type ExecuteToolOptions, executeTool } from '@/tools'
import type { ToolResponse } from '@/tools/types'

export interface ProviderRuntimeContext {
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  /** Trusted server execution context inherited by model-emitted tool calls. */
  executionContext?: ExecutionContext
  /** Request-scoped provider wire ids mapped back to canonical tool registry ids. */
  toolIdByWireId?: ReadonlyMap<string, string>
  /** Failed canonical Function cost omitted from provider tool-result collections. */
  failedFunctionToolCost?: { total: number }
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
  /**
   * `effect` is an input to the egress projection, not content — it reaches the model only as
   * the disclosure record that replaces withheld output. This split spreads every other field
   * through verbatim, so dropping it here is what keeps that true on the provider path too.
   */
  const {
    output: _output,
    error: _error,
    effect: _effect,
    ...functionalFields
  } = rawResponse as ToolResponse & { effect?: unknown }
  return {
    ...functionalFields,
    output: Object.hasOwn(projectedResponse, 'output')
      ? (projectedResponse.output as ToolResponse['output'])
      : {},
    ...(projectedResponse.error !== undefined ? { error: projectedResponse.error } : {}),
  }
}

/**
 * Drops a custom block's child-run handle from the copy bound for the model.
 *
 * The handle has to survive on `rawResponse`, which is what the tool-call record
 * (and therefore the trace span) is built from — but it is trace plumbing, and an
 * opaque execution id in a tool result reads to a model like data the tool
 * returned, which it may then quote back to the user. Applied at this single
 * split point because every provider's tool loop goes through here; there is no
 * other place both copies exist.
 */
function withoutChildTraceHandle(response: ToolResponse): ToolResponse {
  const output = response.output
  if (!isRecordLike(output)) return response
  if (
    !Object.hasOwn(output, CHILD_EXECUTION_ID_OUTPUT_KEY) &&
    !Object.hasOwn(output, CHILD_TRACE_DISABLED_OUTPUT_KEY)
  ) {
    return response
  }
  return {
    ...response,
    output: omit(output, [CHILD_EXECUTION_ID_OUTPUT_KEY, CHILD_TRACE_DISABLED_OUTPUT_KEY]),
  }
}

function accumulateFailedFunctionToolCost(
  toolId: string,
  result: ToolResponse,
  accumulator: ProviderRuntimeContext['failedFunctionToolCost']
): void {
  if (toolId !== 'function_execute' || result.success || !accumulator) return
  if (!isRecordLike(result.output) || !isRecordLike(result.output.cost)) return

  const total = result.output.cost.total
  if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
    accumulator.total += total
  }
}

export async function executeProviderTool(
  toolId: string,
  params: Parameters<typeof executeTool>[1],
  options: ExecuteProviderToolOptions = {}
): Promise<ProviderToolExecutionResult> {
  const runtimeContext = providerRuntimeContext.getStore()
  const executionToolId = runtimeContext?.toolIdByWireId?.get(toolId) ?? toolId
  const registry =
    options.resolvedSecretTraceRegistry ?? runtimeContext?.resolvedSecretTraceRegistry

  if (runtimeContext && Object.hasOwn(runtimeContext, 'resolvedSecretTraceRegistry') && !registry) {
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
    const result = await executeTool(executionToolId, params, {
      ...options,
      ...(executionContext ? { executionContext } : {}),
      resolvedSecretTraceRegistry: toolCallRegistry,
    })
    accumulateFailedFunctionToolCost(
      executionToolId,
      result,
      runtimeContext?.failedFunctionToolCost
    )
    if (!registry || !toolCallRegistry) {
      return { rawResponse: result, modelResponse: withoutChildTraceHandle(result) }
    }

    const modelResponse = withoutChildTraceHandle(
      toProviderModelResponse(result, projectToolResultForCopilot(result, toolCallRegistry))
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
