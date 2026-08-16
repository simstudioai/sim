import { evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import type { SubBlockConfig } from '@/blocks/types'
import type { ParameterVisibility } from '@/tools/types'

/**
 * Visibility assumed for a `tool-input` param that declares none. Matches the tool-row
 * renderer's own fallback, so an unannotated param is never treated as user-required.
 */
const DEFAULT_TOOL_PARAM_VISIBILITY: ParameterVisibility = 'user-or-llm'

/**
 * Whether a param nested in a `tool-input` must be supplied by the USER.
 *
 * Only `user-only` qualifies — it is the one visibility where no other source for the value
 * exists. A `user-or-llm` or `llm-only` param is still mandatory at runtime, but the model
 * supplies it: `createLLMToolSchema` keeps an empty param in the schema handed to the model
 * (and in that schema's `required` list), so a blank value is a deliberate configuration
 * state rather than a missing one.
 *
 * The predicate is deliberately the positive `=== 'user-only'` rather than a
 * `user-or-llm || llm-only` denylist: the two non-user visibilities reach the same verdict
 * for different reasons, and a denylist would silently mis-classify any visibility added
 * later.
 */
export function isToolParamUserRequired(
  config: Pick<SubBlockConfig, 'required' | 'paramVisibility'>,
  values: Record<string, unknown>
): boolean {
  if (!isUserSuppliedToolParam(config)) return false
  return isSubBlockRequired(config.required, values)
}

/**
 * The visibility half of {@link isToolParamUserRequired}, without evaluating `required`.
 *
 * Callers that let a downstream component resolve `required` in its own value context (the
 * tool-row renderer) need exactly this question and must not collapse the condition here —
 * doing so would evaluate it against a different value map than the one the field renders
 * with.
 */
export function isUserSuppliedToolParam(config: Pick<SubBlockConfig, 'paramVisibility'>): boolean {
  return (config.paramVisibility ?? DEFAULT_TOOL_PARAM_VISIBILITY) === 'user-only'
}

/**
 * Resolve a sub-block's `required` declaration against the surrounding values. `true` is
 * unconditional; the object form is structurally a `SubBlockCondition` evaluated against the
 * same value map the editor uses (so an operation-scoped requirement resolves per operation).
 */
export function isSubBlockRequired(
  required: SubBlockConfig['required'],
  values: Record<string, unknown>
): boolean {
  if (required === true) return true
  if (!required) return false
  return evaluateSubBlockCondition(
    required as Parameters<typeof evaluateSubBlockCondition>[0],
    values
  )
}
