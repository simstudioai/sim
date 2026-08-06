import { isPlainRecord } from '@sim/utils/object'
import type { MothershipResource } from '@/lib/copilot/resources/types'
import type { ToolExecutionResult } from '@/lib/copilot/tool-executor/types'
import {
  isResolvedSecretModelContentUnchanged,
  projectResolvedSecretModelContent,
  projectResolvedSecretModelControlMessage,
  projectResolvedSecretModelJsonContent,
} from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export const TOOL_RESULT_UNAVAILABLE_ERROR =
  'Tool execution settled, but its result could not be returned safely. Do not retry a mutation automatically.'
export const TOOL_OUTPUT_PERSISTENCE_UNAVAILABLE_ERROR =
  'Tool output could not be persisted safely because secret provenance was unavailable.'

function structuralResult(result: ToolExecutionResult): ToolExecutionResult {
  return { success: result.success === true }
}

function resourceContent(
  resources: MothershipResource[]
): Array<{ type: string; id: string; title: string; path?: string }> {
  return resources.map((resource) => ({
    type: resource.type,
    id: resource.id,
    title: resource.title,
    ...(resource.path !== undefined ? { path: resource.path } : {}),
  }))
}

function modelSafeResources(
  resources: MothershipResource[],
  registry: ResolvedSecretTraceRegistry | undefined
): MothershipResource[] {
  return resources.filter((resource) =>
    isResolvedSecretModelContentUnchanged([resource.type, resource.id, resource.path], registry)
  )
}

function restoreProjectedResources(
  resources: MothershipResource[],
  projectedContent: unknown
): MothershipResource[] | undefined {
  if (!Array.isArray(projectedContent) || projectedContent.length !== resources.length) {
    return undefined
  }

  const projectedResources: MothershipResource[] = []
  for (let index = 0; index < resources.length; index += 1) {
    const resource = resources[index]
    const content = projectedContent[index]
    if (
      !isPlainRecord(content) ||
      typeof content.type !== 'string' ||
      typeof content.id !== 'string' ||
      typeof content.title !== 'string' ||
      (content.path !== undefined && typeof content.path !== 'string')
    ) {
      return undefined
    }
    if (content.type !== resource.type || content.id !== resource.id) continue

    projectedResources.push({
      type: resource.type,
      id: resource.id,
      title: content.title,
      ...(content.path !== undefined ? { path: content.path } : {}),
    })
  }

  return projectedResources
}

function omittedResult(
  result: ToolExecutionResult,
  registry: ResolvedSecretTraceRegistry | undefined
): ToolExecutionResult {
  if (result.success) return { success: true }

  const error =
    projectResolvedSecretModelControlMessage(TOOL_RESULT_UNAVAILABLE_ERROR, registry) ??
    TOOL_RESULT_UNAVAILABLE_ERROR
  return { success: false, error }
}

export type CopilotToolResultProjection =
  | { safe: true; result: ToolExecutionResult }
  | { safe: false; result: ToolExecutionResult }

export type CopilotPersistedOutputProjection =
  | { safe: true; value: unknown }
  | { safe: false; error: string }

/**
 * Projects only the exact value a Copilot tool is about to persist. The isolated per-tool registry
 * makes this causal: values activated by this tool become canonical `{{NAME}}` aliases, while a
 * public low-entropy value cannot be rewritten merely because an earlier sibling activated the
 * same bytes. Persisting the alias makes later reads safe without a second provenance store.
 */
export function projectToolOutputForPersistence(
  value: unknown,
  registry: ResolvedSecretTraceRegistry | undefined
): CopilotPersistedOutputProjection {
  const projection = projectResolvedSecretModelContent(value, registry)
  return projection.safe
    ? { safe: true, value: projection.value }
    : { safe: false, error: TOOL_OUTPUT_PERSISTENCE_UNAVAILABLE_ERROR }
}

/**
 * Projects terminal tool content and reports whether the complete content was safe to cross.
 * Callers that isolate provenance per tool call may merge that child registry only when `safe`
 * is true and the child is complete. The returned result is always safe to expose: an unsafe
 * projection is reduced to a structural success or failure.
 */
export function inspectToolResultForCopilot(
  result: ToolExecutionResult,
  registry: ResolvedSecretTraceRegistry | undefined
): CopilotToolResultProjection {
  try {
    const content: Record<string, unknown> = {}
    const resources =
      result.resources !== undefined ? modelSafeResources(result.resources, registry) : undefined
    if (Object.hasOwn(result, 'output')) content.output = result.output
    if (Object.hasOwn(result, 'error')) content.error = result.error
    if (resources !== undefined) content.resources = resourceContent(resources)
    const projection = projectResolvedSecretModelJsonContent(content, registry)
    if (!projection.safe || !projection.value || typeof projection.value !== 'object') {
      return { safe: false, result: omittedResult(result, registry) }
    }

    const projectedContent = projection.value as Record<string, unknown>
    const projected = structuralResult(result)
    if (Object.hasOwn(projectedContent, 'output')) projected.output = projectedContent.output
    if (Object.hasOwn(projectedContent, 'error')) {
      if (typeof projectedContent.error !== 'string') {
        return { safe: false, result: omittedResult(result, registry) }
      }
      projected.error = projectedContent.error
    }
    if (resources !== undefined) {
      const projectedResources = restoreProjectedResources(resources, projectedContent.resources)
      if (!projectedResources) {
        return { safe: false, result: omittedResult(result, registry) }
      }
      projected.resources = projectedResources
    }
    if (!projected.success && !projected.error) {
      projected.error = projectResolvedSecretModelControlMessage(
        TOOL_RESULT_UNAVAILABLE_ERROR,
        registry
      )
    }
    return { safe: true, result: projected }
  } catch {
    return { safe: false, result: omittedResult(result, registry) }
  }
}

/**
 * Projects terminal tool content before it can cross back into Copilot.
 * Runtime output remains unchanged for raw post-processing and context updates.
 */
export function projectToolResultForCopilot(
  result: ToolExecutionResult,
  registry: ResolvedSecretTraceRegistry | undefined
): ToolExecutionResult {
  return inspectToolResultForCopilot(result, registry).result
}

/** Projects an error before post-processing can attach it to application logs or OTel events. */
export function projectToolErrorMessageForCopilot(
  error: string,
  registry: ResolvedSecretTraceRegistry | undefined
): string {
  return projectToolResultForCopilot({ success: false, error }, registry).error ?? ''
}
