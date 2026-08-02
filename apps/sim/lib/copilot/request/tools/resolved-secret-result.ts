import { omit } from '@sim/utils/object'
import { FunctionExecute, RunCode } from '@/lib/copilot/generated/tool-catalog-v1'
import type { ToolExecutionResult } from '@/lib/copilot/tool-executor/types'
import {
  containsResolvedSecret,
  createResolvedSecretMatcher,
  projectResolvedSecretContent,
  type ResolvedSecretMatcher,
  sanitizeResolvedSecretString,
} from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export const FUNCTION_RESULT_OMITTED_ERROR = 'Function result omitted'

function isFunctionSandboxTool(toolName: string): boolean {
  return toolName === FunctionExecute.id || toolName === RunCode.id
}

function omitContent(result: ToolExecutionResult): ToolExecutionResult {
  return omit(result, ['output', 'error'])
}

/** Returns a nonempty control error that cannot contain any active literal. */
function createSafeControlError(matcher: ResolvedSecretMatcher | undefined): string {
  if (!matcher) return FUNCTION_RESULT_OMITTED_ERROR

  try {
    const projected = sanitizeResolvedSecretString(FUNCTION_RESULT_OMITTED_ERROR, matcher)
    if (projected.length > 0 && !containsResolvedSecret(projected, matcher)) return projected
  } catch {}

  for (let codePoint = 0x21; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      codePoint = 0xdfff
      continue
    }
    const candidate = String.fromCodePoint(codePoint)
    if (!containsResolvedSecret(candidate, matcher)) return candidate
  }

  throw new Error('Active secret matcher covers every Unicode scalar')
}

function omittedResult(
  result: ToolExecutionResult,
  matcher: ResolvedSecretMatcher | undefined
): ToolExecutionResult {
  const structural = omitContent(result)
  return result.success ? structural : { ...structural, error: createSafeControlError(matcher) }
}

/**
 * Projects only the Function sandbox content that can cross into Copilot.
 * Runtime output remains local and unchanged for post-processing and resource side effects.
 */
export function projectFunctionResultForCopilot(
  toolName: string,
  result: ToolExecutionResult,
  registry: ResolvedSecretTraceRegistry | undefined
): ToolExecutionResult {
  if (!isFunctionSandboxTool(toolName)) return result
  if (!registry?.isComplete()) return omittedResult(result, undefined)

  let matcher: ResolvedSecretMatcher | undefined
  try {
    matcher = createResolvedSecretMatcher(registry.getActiveMatches())
    if (!matcher) return result

    const content: Record<string, unknown> = {}
    if (Object.hasOwn(result, 'output')) content.output = result.output
    if (Object.hasOwn(result, 'error')) content.error = result.error
    const projection = projectResolvedSecretContent(content, matcher)
    if (!projection.safe || !projection.value || typeof projection.value !== 'object') {
      return omittedResult(result, matcher)
    }

    const projectedContent = projection.value as Record<string, unknown>
    const projected = omitContent(result)
    if (Object.hasOwn(projectedContent, 'output')) projected.output = projectedContent.output
    if (Object.hasOwn(projectedContent, 'error')) {
      projected.error = String(projectedContent.error)
    }
    if (!projected.success && !projected.error) {
      projected.error = createSafeControlError(matcher)
    }
    return projected
  } catch {
    return omittedResult(result, matcher)
  }
}
