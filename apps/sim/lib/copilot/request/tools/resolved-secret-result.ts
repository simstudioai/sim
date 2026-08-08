import type { ToolExecutionResult } from '@/lib/copilot/tool-executor/types'
import { projectResolvedSecretModelJsonContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export const TOOL_RESULT_UNAVAILABLE_ERROR =
  'Tool execution settled, but its result could not be returned safely. Do not retry a mutation automatically.'

function structuralResult(result: ToolExecutionResult): ToolExecutionResult {
  return { success: result.success === true }
}

function omittedResult(result: ToolExecutionResult): ToolExecutionResult {
  if (result.success) return { success: true }
  return { success: false, error: TOOL_RESULT_UNAVAILABLE_ERROR }
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
  registry: ResolvedSecretTraceRegistry | undefined
): CopilotToolResultProjection {
  try {
    const resultRegistry = registry?.forkForPropagatedEntries()
    const content: Record<string, unknown> = {}
    const resources = result.resources
    if (Object.hasOwn(result, 'output')) content.output = result.output
    if (Object.hasOwn(result, 'error')) content.error = result.error
    const projection = projectResolvedSecretModelJsonContent(content, resultRegistry)
    if (!projection.safe || !projection.value || typeof projection.value !== 'object') {
      return { safe: false, result: omittedResult(result) }
    }

    const projectedContent = projection.value as Record<string, unknown>
    const projected = structuralResult(result)
    if (Object.hasOwn(projectedContent, 'output')) projected.output = projectedContent.output
    if (Object.hasOwn(projectedContent, 'error')) {
      if (typeof projectedContent.error !== 'string') {
        return { safe: false, result: omittedResult(result) }
      }
      projected.error = projectedContent.error
    }
    if (resources !== undefined) {
      projected.resources = resources
    }
    if (!projected.success && !projected.error) {
      projected.error = TOOL_RESULT_UNAVAILABLE_ERROR
    }
    return { safe: true, result: projected }
  } catch {
    return { safe: false, result: omittedResult(result) }
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
