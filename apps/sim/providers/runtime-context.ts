import { AsyncLocalStorage } from 'node:async_hooks'
import { getErrorMessage } from '@sim/utils/errors'
import {
  isResolvedSecretModelContentUnchanged,
  projectResolvedSecretModelContent,
  projectResolvedSecretModelControlMessage,
} from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { type ExecuteToolOptions, executeTool } from '@/tools'
import type { ToolResponse } from '@/tools/types'

export interface ProviderRuntimeContext {
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
}

const providerRuntimeContext = new AsyncLocalStorage<ProviderRuntimeContext | undefined>()

export function runWithProviderRuntimeContext<T>(
  context: ProviderRuntimeContext | undefined,
  callback: () => T
): T {
  return providerRuntimeContext.run(context, callback)
}

function omittedProviderToolResponse(
  result: ToolResponse,
  registry: ResolvedSecretTraceRegistry
): ToolResponse {
  const error = result.success
    ? undefined
    : projectResolvedSecretModelControlMessage('Tool result omitted', registry)
  return {
    success: result.success === true,
    output: {},
    ...(error ? { error } : {}),
  }
}

function projectProviderToolResponse(
  result: ToolResponse,
  registry: ResolvedSecretTraceRegistry
): ToolResponse {
  const sourceResources = result.resources?.filter((resource) =>
    isResolvedSecretModelContentUnchanged([resource.type, resource.id, resource.path], registry)
  )
  const projection = projectResolvedSecretModelContent(
    [
      result.output,
      result.error,
      sourceResources?.map((resource) => [
        resource.type,
        resource.id,
        resource.title,
        resource.path,
      ]),
    ],
    registry
  )
  if (!projection.safe || !Array.isArray(projection.value) || projection.value.length !== 3) {
    return omittedProviderToolResponse(result, registry)
  }

  const [output, error, resourceTitles] = projection.value
  if (output === undefined || (error !== undefined && typeof error !== 'string')) {
    return omittedProviderToolResponse(result, registry)
  }
  let resources = sourceResources
  if (resources !== undefined) {
    if (!Array.isArray(resourceTitles) || resourceTitles.length !== resources.length) {
      return omittedProviderToolResponse(result, registry)
    }
    const projectedResources: NonNullable<ToolResponse['resources']> = []
    for (let index = 0; index < resources.length; index += 1) {
      const resource = resources[index]
      const projectedResource = resourceTitles[index]
      if (
        !Array.isArray(projectedResource) ||
        projectedResource.length !== 4 ||
        typeof projectedResource[0] !== 'string' ||
        typeof projectedResource[1] !== 'string' ||
        typeof projectedResource[2] !== 'string' ||
        (resource.path === undefined
          ? projectedResource[3] !== undefined
          : typeof projectedResource[3] !== 'string')
      ) {
        return omittedProviderToolResponse(result, registry)
      }
      if (projectedResource[0] !== resource.type || projectedResource[1] !== resource.id) continue
      projectedResources.push({
        type: resource.type,
        id: resource.id,
        title: projectedResource[2],
        ...(resource.path !== undefined ? { path: projectedResource[3] } : {}),
      })
    }
    resources = projectedResources
  } else if (resourceTitles !== undefined) {
    return omittedProviderToolResponse(result, registry)
  }

  return {
    success: result.success === true,
    output: output as ToolResponse['output'],
    ...(error !== undefined ? { error } : {}),
    ...(resources !== undefined ? { resources } : {}),
  }
}

export async function executeProviderTool(
  toolId: string,
  params: Parameters<typeof executeTool>[1],
  options: ExecuteToolOptions = {}
): Promise<ToolResponse> {
  const runtimeContext = providerRuntimeContext.getStore()
  const registry =
    options.resolvedSecretTraceRegistry ?? runtimeContext?.resolvedSecretTraceRegistry

  if (runtimeContext && !registry) return { success: false, output: {} }

  try {
    const result = await executeTool(toolId, params, {
      ...options,
      resolvedSecretTraceRegistry: registry,
    })
    return registry ? projectProviderToolResponse(result, registry) : result
  } catch (error) {
    if (!registry) throw error
    const message = projectResolvedSecretModelControlMessage(getErrorMessage(error), registry) ?? ''
    const errorName =
      error && typeof error === 'object' && 'name' in error ? String(error.name) : undefined
    if (errorName === 'AbortError' || errorName === 'APIUserAbortError') {
      throw new DOMException(message, 'AbortError')
    }
    throw new Error(message)
  }
}
