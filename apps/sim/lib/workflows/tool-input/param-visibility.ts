import type { ResolvedToolInputParamConfig } from '@/lib/workflows/search-replace/indexer'
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
function isToolParamUserRequired(
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
 * Resolved visibility per `tool-input` param, keyed by sub-block id and by canonical param id,
 * since a nested tool stores picks under either. Only authoritative configs count. A canonical
 * id is an alias, so it never overwrites a param that owns that key as its own id.
 */
export function buildToolParamVisibilityMap(
  resolvedParams: ResolvedToolInputParamConfig[]
): Map<string, ParameterVisibility | undefined> {
  const visibilityById = new Map<string, ParameterVisibility | undefined>()
  for (const resolved of resolvedParams) {
    if (!resolved.authoritative) continue
    const visibility = resolved.config.paramVisibility
    visibilityById.set(resolved.paramId, visibility)
    const canonicalParamId = resolved.config.canonicalParamId
    if (canonicalParamId && !visibilityById.has(canonicalParamId)) {
      visibilityById.set(canonicalParamId, visibility)
    }
  }
  return visibilityById
}

/**
 * Whether a `tool-input` param must be supplied by the user, resolving its visibility from a
 * map keyed by sub-block id and canonical param id.
 *
 * Shared by fork sync's PRE-sync collector (which decides whether a row blocks the Sync
 * button) and its POST-sync collector (whose `required` entries make promote SKIP the
 * target's redeploy). Those two must agree: if the modal lets a sync through because a param
 * is the model's to fill, the promote path must not then withhold the deployment for the
 * same param.
 *
 * `paramVisibilityById` omitted means the caller is not in a tool-input context (a block's
 * own sub-blocks), so the plain block-level rule applies. A param absent from the map, or
 * present with an `undefined` value, falls back the same way — failing closed.
 */
export function resolveToolParamRequired(
  config: Pick<SubBlockConfig, 'id' | 'required' | 'canonicalParamId'>,
  values: Record<string, unknown>,
  paramVisibilityById?: ReadonlyMap<string, ParameterVisibility | undefined>
): boolean {
  if (!paramVisibilityById) return isSubBlockRequired(config.required, values)
  const visibility =
    paramVisibilityById.get(config.id) ??
    (config.canonicalParamId ? paramVisibilityById.get(config.canonicalParamId) : undefined)
  if (visibility === undefined) return isSubBlockRequired(config.required, values)
  return isToolParamUserRequired({ required: config.required, paramVisibility: visibility }, values)
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
