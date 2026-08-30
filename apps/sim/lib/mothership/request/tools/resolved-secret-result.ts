import type { ToolCallEffect, ToolExecutionResult } from '@/lib/mothership/tool-executor/types'
import { TOOL_EFFECT_PHASE } from '@/lib/mothership/tool-executor/types'
import { projectResolvedSecretModelJsonContent } from '@/executor/utils/resolved-secret-content-projection'
import type {
  ResolvedSecretIncompletenessReason,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

export const TOOL_RESULT_UNAVAILABLE_ERROR =
  'Tool execution settled, but its result could not be returned safely. Do not retry a mutation automatically.'

/**
 * Read-only tools carry no mutation-retry hazard, so their withheld results
 * must not warn against retrying — that wording makes the model abandon
 * harmless reads it could simply try again or work around.
 */
export const READ_TOOL_RESULT_UNAVAILABLE_ERROR =
  'Tool executed, but its result could not be returned safely. The call was read-only, so you may retry it or continue without the result.'

/**
 * Withheld-result wording for a call that disclosed how far its side effect got.
 *
 * The generic message above has to cover both "nothing happened" and "it happened,
 * you just cannot see it", which is why a caller could not build a retry policy from
 * it: a rejected call and a completed mutation read identically. A tool that declares
 * its {@link ToolCallEffect} gets the phrasing its phase actually warrants.
 */
const WITHHELD_ERROR_BY_EFFECT_PHASE: Record<ToolCallEffect['phase'], string> = {
  [TOOL_EFFECT_PHASE.notAttempted]:
    'Tool call was rejected before it ran, so nothing was created or changed. The reason could not be returned safely — correct the call and try again.',
  [TOOL_EFFECT_PHASE.attempted]:
    'Tool execution was dispatched but its outcome could not be returned safely. At most one run exists for the ids in this result — resolve it before retrying a mutation.',
  [TOOL_EFFECT_PHASE.performed]:
    'Tool execution completed but its result could not be returned safely. Do not retry — read the outcome using the ids in this result.',
}

const READ_ONLY_RESULT_TOOLS = new Set(['read', 'glob', 'grep'])

/**
 * The shape of an identifier this system mints — `generateId`'s UUID, and the
 * database ids that share it. Effect ids bypass secret projection, so the set of
 * values that may occupy one is pinned to a syntax no credential we issue or store
 * takes. A caller with a differently shaped id has to widen this deliberately,
 * where the exemption is reviewed, rather than by passing it.
 */
const SERVER_MINTED_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Field names the disclosure record owns; an id may not take one. */
const RESERVED_DISCLOSURE_KEYS = new Set(['resultWithheld', 'effect'])

/** Chooses the withheld-result message a tool's caller should surface. */
export function toolResultUnavailableError(toolId?: string): string {
  return toolId && READ_ONLY_RESULT_TOOLS.has(toolId)
    ? READ_TOOL_RESULT_UNAVAILABLE_ERROR
    : TOOL_RESULT_UNAVAILABLE_ERROR
}

/**
 * Why complete content could not cross, for the caller that is about to log a refusal.
 *
 * The three causes need different fixes — a latched registry names the guard that tripped,
 * an absent one means the surface never built a catalog, and a content refusal means the
 * registry was fine and the payload itself was unprojectable — so they are not collapsed.
 */
export type ToolResultWithholdingCause =
  | {
      kind: 'registry-incomplete'
      reasons: readonly ResolvedSecretIncompletenessReason[]
      origins: readonly string[]
    }
  | { kind: 'registry-absent' }
  | { kind: 'content-refused' }

export type CopilotToolResultProjection =
  | { safe: true; result: ToolExecutionResult }
  | { safe: false; result: ToolExecutionResult; cause: ToolResultWithholdingCause }

function structuralResult(result: ToolExecutionResult): ToolExecutionResult {
  return { success: result.success === true }
}

/**
 * Reduces a withheld result to the facts the tool asserted about the call itself.
 *
 * Content is dropped because nothing here can prove it secret-free. The effect
 * disclosure survives because it is not derived from content: the phase is a
 * code-defined literal and every id is checked against {@link SERVER_MINTED_ID_PATTERN}.
 * An id that fails that check voids the whole disclosure rather than being dropped
 * on its own — a partially honoured exemption is the one shape a reader would
 * misread as complete.
 */
function omittedResult(result: ToolExecutionResult, toolId?: string): ToolExecutionResult {
  const effect = vouchableEffect(result.effect)
  if (!effect) {
    return result.success
      ? { success: true }
      : { success: false, error: toolResultUnavailableError(toolId) }
  }

  return {
    success: result.success === true,
    output: { resultWithheld: true, effect: effect.phase, ...effect.ids },
    ...(result.success ? {} : { error: WITHHELD_ERROR_BY_EFFECT_PHASE[effect.phase] }),
  }
}

/**
 * Returns the disclosure only when every id it carries is a shape this system mints and none
 * of them would displace the record's own fields. An id named `effect` overwriting the phase
 * would corrupt exactly the field the retry decision reads, so a collision voids the
 * disclosure on the same all-or-nothing terms as an unvouchable id.
 */
function vouchableEffect(effect: ToolCallEffect | undefined): ToolCallEffect | undefined {
  if (!effect) return undefined
  for (const [key, value] of Object.entries(effect.ids ?? {})) {
    if (RESERVED_DISCLOSURE_KEYS.has(key)) return undefined
    if (typeof value !== 'string' || !SERVER_MINTED_ID_PATTERN.test(value)) return undefined
  }
  return effect
}

function withholdingCause(
  registry: ResolvedSecretTraceRegistry | undefined
): ToolResultWithholdingCause {
  if (!registry) return { kind: 'registry-absent' }
  const diagnostics = registry.getIncompletenessDiagnostics()
  return diagnostics
    ? {
        kind: 'registry-incomplete',
        reasons: diagnostics.reasons,
        origins: diagnostics.origins,
      }
    : { kind: 'content-refused' }
}

function withheld(
  result: ToolExecutionResult,
  registry: ResolvedSecretTraceRegistry | undefined,
  toolId: string | undefined
): CopilotToolResultProjection {
  return {
    safe: false,
    result: omittedResult(result, toolId),
    cause: withholdingCause(registry),
  }
}

/**
 * Projects terminal tool content and reports whether the complete content was safe to cross.
 * Callers that isolate provenance per tool call may merge that child registry only when `safe`
 * is true and the child is complete. The returned result is always safe to expose: an unsafe
 * projection is reduced to a structural success or failure, plus any effect the tool disclosed.
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
      return withheld(result, resultRegistry, toolId)
    }

    const projectedContent = projection.value as Record<string, unknown>
    const projected = structuralResult(result)
    if (Object.hasOwn(projectedContent, 'output')) projected.output = projectedContent.output
    if (Object.hasOwn(projectedContent, 'error')) {
      if (typeof projectedContent.error !== 'string') {
        return withheld(result, resultRegistry, toolId)
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
    return withheld(result, registry, toolId)
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

/** Flattens a withholding cause into log/span fields, so every surface reports it alike. */
export function describeWithholdingCause(
  cause: ToolResultWithholdingCause
): Record<string, unknown> {
  return cause.kind === 'registry-incomplete'
    ? {
        withheldCause: cause.kind,
        withheldReasons: [...cause.reasons],
        ...(cause.origins.length > 0 ? { withheldOrigins: [...cause.origins] } : {}),
      }
    : { withheldCause: cause.kind }
}
