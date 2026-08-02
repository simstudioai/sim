import { AsyncLocalStorage } from 'node:async_hooks'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { type ExecuteToolOptions, executeTool } from '@/tools'
import type { ToolResponse } from '@/tools/types'

export interface ProviderRuntimeContext {
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
}

const providerRuntimeContext = new AsyncLocalStorage<ProviderRuntimeContext>()

export function runWithProviderRuntimeContext<T>(
  context: ProviderRuntimeContext | undefined,
  callback: () => T
): T {
  return providerRuntimeContext.run(context ?? {}, callback)
}

export function executeProviderTool(
  toolId: string,
  params: Parameters<typeof executeTool>[1],
  options: ExecuteToolOptions = {}
): Promise<ToolResponse> {
  return executeTool(toolId, params, {
    ...options,
    resolvedSecretTraceRegistry:
      options.resolvedSecretTraceRegistry ??
      providerRuntimeContext.getStore()?.resolvedSecretTraceRegistry,
  })
}
