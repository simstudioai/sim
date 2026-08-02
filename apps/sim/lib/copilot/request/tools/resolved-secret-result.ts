import { isPlainRecord, omit } from '@sim/utils/object'
import type { MothershipResource } from '@/lib/copilot/resources/types'
import type { ToolExecutionResult } from '@/lib/copilot/tool-executor/types'
import {
  containsResolvedSecret,
  createResolvedSecretMatcher,
  projectResolvedSecretContent,
  type ResolvedSecretMatcher,
  sanitizeResolvedSecretString,
} from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export const TOOL_RESULT_OMITTED_ERROR = 'Tool result omitted'

function omitContent(result: ToolExecutionResult): ToolExecutionResult {
  return omit(result, ['output', 'error', 'resources'])
}

function resourceContent(resources: MothershipResource[]): Array<{ title: string; path?: string }> {
  return resources.map((resource) => ({
    title: resource.title,
    ...(resource.path !== undefined ? { path: resource.path } : {}),
  }))
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
    const content = projectedContent[index]
    if (
      !isPlainRecord(content) ||
      typeof content.title !== 'string' ||
      (content.path !== undefined && typeof content.path !== 'string')
    ) {
      return undefined
    }

    const resource = resources[index]
    projectedResources.push({
      type: resource.type,
      id: resource.id,
      title: content.title,
      ...(content.path !== undefined ? { path: content.path } : {}),
    })
  }

  return projectedResources
}

/** Returns a nonempty control error that cannot contain any active literal. */
function createSafeControlError(matcher: ResolvedSecretMatcher | undefined): string {
  if (!matcher) return TOOL_RESULT_OMITTED_ERROR

  try {
    const projected = sanitizeResolvedSecretString(TOOL_RESULT_OMITTED_ERROR, matcher)
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
 * Projects terminal tool content before it can cross back into Copilot.
 * Runtime output remains unchanged for raw post-processing and context updates.
 */
export function projectToolResultForCopilot(
  result: ToolExecutionResult,
  registry: ResolvedSecretTraceRegistry | undefined
): ToolExecutionResult {
  if (!registry?.isComplete()) return omittedResult(result, undefined)

  let matcher: ResolvedSecretMatcher | undefined
  try {
    matcher = createResolvedSecretMatcher(registry.getActiveMatches())
    if (!matcher) return result

    const content: Record<string, unknown> = {}
    if (Object.hasOwn(result, 'output')) content.output = result.output
    if (Object.hasOwn(result, 'error')) content.error = result.error
    if (result.resources !== undefined) content.resources = resourceContent(result.resources)
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
    if (result.resources !== undefined) {
      const resources = restoreProjectedResources(result.resources, projectedContent.resources)
      if (!resources) return omittedResult(result, matcher)
      projected.resources = resources
    }
    if (!projected.success && !projected.error) {
      projected.error = createSafeControlError(matcher)
    }
    return projected
  } catch {
    return omittedResult(result, matcher)
  }
}

/** Projects an error before post-processing can attach it to application logs or OTel events. */
export function projectToolErrorMessageForCopilot(
  error: string,
  registry: ResolvedSecretTraceRegistry | undefined
): string {
  return (
    projectToolResultForCopilot({ success: false, error }, registry).error ??
    TOOL_RESULT_OMITTED_ERROR
  )
}
