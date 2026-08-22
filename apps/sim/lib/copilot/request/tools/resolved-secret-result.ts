import type { ToolExecutionResult } from '@/lib/copilot/tool-executor/types'
import { projectResolvedSecretModelJsonContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export const TOOL_RESULT_UNAVAILABLE_ERROR =
  'Tool execution settled, but its result could not be returned safely. Do not retry a mutation automatically.'

/**
 * Read-only tools carry no mutation-retry hazard, so their withheld results
 * must not warn against retrying — that wording makes the model abandon
 * harmless reads it could simply try again or work around.
 */
export const READ_TOOL_RESULT_UNAVAILABLE_ERROR =
  'Tool executed, but its result could not be returned safely. The call was read-only, so you may retry it or continue without the result.'

const READ_ONLY_RESULT_TOOLS = new Set(['read', 'glob', 'grep'])

/** Chooses the withheld-result message a tool's caller should surface. */
export function toolResultUnavailableError(toolId?: string): string {
  return toolId && READ_ONLY_RESULT_TOOLS.has(toolId)
    ? READ_TOOL_RESULT_UNAVAILABLE_ERROR
    : TOOL_RESULT_UNAVAILABLE_ERROR
}

function structuralResult(result: ToolExecutionResult): ToolExecutionResult {
  return { success: result.success === true }
}

function omittedResult(result: ToolExecutionResult, toolId?: string): ToolExecutionResult {
  if (result.success) return { success: true }
  return { success: false, error: toolResultUnavailableError(toolId) }
}

export type CopilotToolResultProjection =
  | { safe: true; result: ToolExecutionResult }
  | { safe: false; result: ToolExecutionResult }

/**
 * Projects terminal tool content and reports whether the complete content was safe to cross.
 * Callers that isolate provenance per tool call may merge that child registry only when `safe`
 * is true and the child is complete. The returned result is always safe to expose: an unsafe
 * projection is reduced to a structural success or failure.
 */
export function inspectToolResultForCopilot(
  result: ToolExecutionResult,
  registry: ResolvedSecretTraceRegistry | undefined,
  toolId?: string
): CopilotToolResultProjection {
  try {
    const resultRegistry = registry?.forkForPropagatedEntries()
    const content: Record<string, unknown> = {}
    const resources = result.resources
    if (Object.hasOwn(result, 'output')) content.output = result.output
    if (Object.hasOwn(result, 'error')) content.error = result.error
    const projection = projectResolvedSecretModelJsonContent(content, resultRegistry)
    if (!projection.safe || !projection.value || typeof projection.value !== 'object') {
      return { safe: false, result: omittedResult(result, toolId) }
    }

    const projectedContent = projection.value as Record<string, unknown>
    const projected = structuralResult(result)
    if (Object.hasOwn(projectedContent, 'output')) projected.output = projectedContent.output
    if (Object.hasOwn(projectedContent, 'error')) {
      if (typeof projectedContent.error !== 'string') {
        return { safe: false, result: omittedResult(result, toolId) }
      }
      projected.error = projectedContent.error
    }
    if (resources !== undefined) {
      projected.resources = resources
    }
    if (!projected.success && !projected.error) {
      projected.error = toolResultUnavailableError(toolId)
    }
    return { safe: true, result: projected }
  } catch {
    return { safe: false, result: omittedResult(result, toolId) }
  }
}

/**
 * Projects terminal tool content before it can cross back into Copilot.
 * Runtime output remains unchanged for raw post-processing and context updates.
 */
export function projectToolResultForCopilot(
  result: ToolExecutionResult,
  registry: ResolvedSecretTraceRegistry | undefined,
  toolId?: string
): ToolExecutionResult {
  return inspectToolResultForCopilot(result, registry, toolId).result
}

/** Projects an error before post-processing can attach it to application logs or OTel events. */
export function projectToolErrorMessageForCopilot(
  error: string,
  registry: ResolvedSecretTraceRegistry | undefined,
  toolId?: string
): string {
  return projectToolResultForCopilot({ success: false, error }, registry, toolId).error ?? ''
}
