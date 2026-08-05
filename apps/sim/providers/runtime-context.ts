import { AsyncLocalStorage } from 'node:async_hooks'
import { getErrorMessage } from '@sim/utils/errors'
import {
  projectResolvedSecretModelContent,
  projectResolvedSecretModelControlMessage,
} from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { type ExecuteToolOptions, executeTool } from '@/tools'
import type { ToolResponse } from '@/tools/types'

export interface ProviderRuntimeContext {
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
}

export interface ExecuteProviderToolOptions extends ExecuteToolOptions {
  /** Exact merged tool arguments, excluding execution-only ambient context. */
  toolInput: Record<string, unknown>
}

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

/** Projects a filename only when a provider adapter is about to serialize it upstream. */
export function projectProviderAttachmentFilenameForModel(
  filename: string,
  extension: string
): string {
  const registry = providerRuntimeContext.getStore()?.resolvedSecretTraceRegistry
  if (!registry) return filename

  const projection = projectResolvedSecretModelContent(filename, registry)
  if (!projection.safe || typeof projection.value !== 'string') {
    throw new Error('Model input could not be safely projected')
  }

  const projected = projection.value
  const suffix = extension ? `.${extension}` : ''
  const hadSuffix = suffix !== '' && filename.toLowerCase().endsWith(suffix.toLowerCase())
  const retainedSuffix = suffix !== '' && projected.toLowerCase().endsWith(suffix.toLowerCase())
  return hadSuffix && !retainedSuffix ? `${projected}${suffix}` : projected
}

function omittedProviderToolResponse(
  result: ToolResponse,
  registry: ResolvedSecretTraceRegistry
): ToolResponse {
  const error = result.success
    ? undefined
    : projectResolvedSecretModelControlMessage('Tool result omitted', registry)
  const { output: _output, error: _error, ...functionalFields } = result
  return {
    ...functionalFields,
    output: {},
    ...(error ? { error } : {}),
  }
}

type ProviderToolResponseProjection =
  | { safe: true; response: ToolResponse }
  | { safe: false; response: ToolResponse }

function projectProviderToolResponse(
  result: ToolResponse,
  registry: ResolvedSecretTraceRegistry
): ProviderToolResponseProjection {
  const projection = projectResolvedSecretModelContent([result.output, result.error], registry)
  if (!projection.safe || !Array.isArray(projection.value) || projection.value.length !== 2) {
    return { safe: false, response: omittedProviderToolResponse(result, registry) }
  }

  const [output, error] = projection.value
  if (output === undefined || (error !== undefined && typeof error !== 'string')) {
    return { safe: false, response: omittedProviderToolResponse(result, registry) }
  }
  const { output: _output, error: _error, ...functionalFields } = result

  return {
    safe: true,
    response: {
      ...functionalFields,
      output: output as ToolResponse['output'],
      ...(error !== undefined ? { error } : {}),
    },
  }
}

export async function executeProviderTool(
  toolId: string,
  params: Parameters<typeof executeTool>[1],
  options: ExecuteProviderToolOptions
): Promise<ProviderToolExecutionResult> {
  const runtimeContext = providerRuntimeContext.getStore()
  const { toolInput, ...executeToolOptions } = options
  const registry =
    options.resolvedSecretTraceRegistry ?? runtimeContext?.resolvedSecretTraceRegistry

  if (runtimeContext && !registry) {
    const response: ToolResponse = { success: false, output: {} }
    return { rawResponse: response, modelResponse: response }
  }
  const toolCallRegistry = registry?.forkForToolInputValues(Object.values(toolInput))

  try {
    const result = await executeTool(toolId, params, {
      ...executeToolOptions,
      resolvedSecretTraceRegistry: toolCallRegistry,
    })
    if (!registry || !toolCallRegistry) {
      return { rawResponse: result, modelResponse: result }
    }

    const projection = projectProviderToolResponse(result, toolCallRegistry)
    registry.mergeToolCallRegistry(toolCallRegistry)
    return { rawResponse: result, modelResponse: projection.response }
  } catch (error) {
    if (!registry || !toolCallRegistry) throw error
    const projectedMessage = projectResolvedSecretModelControlMessage(
      getErrorMessage(error),
      toolCallRegistry
    )
    registry.mergeToolCallRegistry(toolCallRegistry)
    const errorName =
      error && typeof error === 'object' && 'name' in error ? String(error.name) : undefined
    if (errorName === 'AbortError' || errorName === 'APIUserAbortError') {
      throw error
    }
    const rawResponse: ToolResponse = {
      success: false,
      output: {},
      error: getErrorMessage(error),
    }
    const modelResponse: ToolResponse = {
      success: false,
      output: {},
      ...(projectedMessage !== undefined ? { error: projectedMessage } : {}),
    }
    return { rawResponse, modelResponse }
  }
}
