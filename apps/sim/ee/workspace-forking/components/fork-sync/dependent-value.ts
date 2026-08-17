import type { ForkDependentReconfig } from '@/lib/api/contracts/workspace-fork'

/** Stable key for a per-target dependent re-pick (target workflow + block + subblock). */
export function dependentKey(dependent: ForkDependentReconfig): string {
  return `${dependent.targetWorkflowId}:${dependent.targetBlockId}:${dependent.subBlockKey}`
}

/**
 * Marker stored for a descendant whose value an in-session parent re-pick invalidated, kept
 * distinct from the user's own empty pick. It reads as blank everywhere it is consumed - the
 * selector, the in-block chain context, and the sync gate - but is never submitted: the user
 * has not chosen a replacement, so the target keeps its stored value instead of being blanked.
 * A `''` the user picked themselves IS submitted and does clear the target.
 *
 * The escaped NUL prefix keeps it disjoint from every real selector value (ids, names, label
 * paths) - no selector can produce one, so it can never collide with a genuine pick.
 */
export const DEPENDENT_CLEARED_BY_PARENT = '\u0000fork-sync:cleared-by-parent'

/**
 * Store a dependent re-pick and invalidate every selector transitively scoped by it, marking
 * each with `DEPENDENT_CLEARED_BY_PARENT`: a changed provider makes every stored descendant
 * stale for both mapped and copied parents, but only the fields the user reviews themselves
 * get written to the target.
 *
 * `previousValue` is the field's effective value before the pick. `onChange` fires even when
 * the user re-selects the value the field already had, and that pick moves no scope, so nothing
 * below it went stale - the cascade is skipped. Omit it only where no prior value is known.
 */
export function applyDependentRepick(
  reconfig: Record<string, string>,
  changedField: ForkDependentReconfig,
  blockFields: ForkDependentReconfig[],
  value: string,
  previousValue?: string
): Record<string, string> {
  const changedKey = dependentKey(changedField)
  const nextState = { ...reconfig, [changedKey]: value }
  if (previousValue !== undefined && previousValue === value) return nextState
  if (!changedField.providesContextKey) return nextState

  const pendingContextKeys = [changedField.providesContextKey]
  const visitedFields = new Set([changedKey])
  for (let index = 0; index < pendingContextKeys.length; index += 1) {
    const contextKey = pendingContextKeys[index]
    if (!contextKey) continue

    for (const field of blockFields) {
      const fieldKey = dependentKey(field)
      if (visitedFields.has(fieldKey) || !field.consumesContextKeys.includes(contextKey)) continue

      visitedFields.add(fieldKey)
      nextState[fieldKey] = DEPENDENT_CLEARED_BY_PARENT
      if (field.providesContextKey) pendingContextKeys.push(field.providesContextKey)
    }
  }

  return nextState
}

/**
 * The value sent + displayed for a dependent: the user's in-session re-pick if present, else the
 * stored value (`currentValue`). Blank when the parent target changed in-session, or when an
 * in-block parent re-pick invalidated it, since the old stored value was for the previous parent
 * and won't resolve against the new one. Shared by the sync gate and the per-block selector so
 * the rule can't drift between them. What gets SUBMITTED is `submittedDependentValue`, which
 * additionally omits the fields the user has not reviewed.
 */
export function effectiveDependentValue(
  field: ForkDependentReconfig,
  reconfig: Record<string, string>,
  parentChanged: boolean
): string {
  const repicked = reconfig[dependentKey(field)]
  if (repicked === DEPENDENT_CLEARED_BY_PARENT) return ''
  if (repicked !== undefined) return repicked
  return parentChanged ? '' : field.currentValue
}

/**
 * The value sent + displayed for a dependent whose parent is resolved by COPY: the user's
 * in-session re-pick, else the stored value, else the field's raw SOURCE reference. The copy
 * brings the source parent's children along (a copied KB carries its referenced documents), so
 * the source reference is exactly what the copied parent will contain - the selector browses the
 * SOURCE parent and this seed resolves there. An explicit empty re-pick is respected (it gates a
 * required field as usual).
 */
export function effectiveCopyDependentValue(
  field: ForkDependentReconfig,
  reconfig: Record<string, string>
): string {
  const repicked = reconfig[dependentKey(field)]
  if (repicked === DEPENDENT_CLEARED_BY_PARENT) return ''
  if (repicked !== undefined) return repicked
  return field.currentValue || field.sourceValue
}

/**
 * Whether an in-block parent re-pick invalidated this field and the user has not re-picked it
 * since. Such a field shows blank but is not submitted: blanking the target on the user's behalf
 * would destroy a stored value they never chose to clear.
 */
export function isDependentClearedByParent(
  field: ForkDependentReconfig,
  reconfig: Record<string, string>
): boolean {
  return reconfig[dependentKey(field)] === DEPENDENT_CLEARED_BY_PARENT
}

/**
 * The value this dependent contributes to the submitted mapping, or `undefined` when it must be
 * OMITTED so the target keeps what it already stores. Only a field the user reviewed is written:
 * an explicit empty pick clears the target, while a value merely invalidated by a parent re-pick
 * is left alone (it is on screen and blank, and if it is required the sync gate blocks until the
 * user picks one - `effectiveDependentValue` reports it as blank).
 */
export function submittedDependentValue(
  field: ForkDependentReconfig,
  reconfig: Record<string, string>,
  state: { copying: boolean; parentChanged: boolean }
): string | undefined {
  if (isDependentClearedByParent(field, reconfig)) return undefined
  return state.copying
    ? effectiveCopyDependentValue(field, reconfig)
    : effectiveDependentValue(field, reconfig, state.parentChanged)
}

export interface DependentConfigurationState {
  parentResolved: boolean
  parentChanged: boolean
  copying: boolean
}

/**
 * Whether a dependent selector needs to be shown. A changed or copied parent requires review
 * because its children resolve in a different scope. An unchanged mapping only needs a selector
 * when a required value is missing; its stored values are already valid and sync-ready.
 *
 * Anything the session already touched stays shown - the user picked it, cleared it, or a parent
 * re-pick invalidated it. Re-deriving pure satisfaction would pull the field (and, when it is its
 * block's only one, the whole workflow card) out from under the user the instant they filled it
 * in, and would hide a descendant a parent re-pick just blanked.
 */
export function isDependentConfigurationActionable(
  field: ForkDependentReconfig,
  reconfig: Record<string, string>,
  state: DependentConfigurationState
): boolean {
  if (!state.parentResolved) return false
  if (state.parentChanged || state.copying) return true
  if (reconfig[dependentKey(field)] !== undefined) return true
  return field.required && effectiveDependentValue(field, reconfig, false) === ''
}

/**
 * Actionable fields plus the transitive in-block providers that scope them. A provider belongs
 * in the configuration UI whenever one of its descendants needs action, even if its saved value
 * is present, so the user can see and change the context in which the child is selected.
 */
export function getActionableDependentFields(
  fields: ForkDependentReconfig[],
  reconfig: Record<string, string>,
  state: DependentConfigurationState
): ForkDependentReconfig[] {
  const actionable = new Set(
    fields.filter((field) => isDependentConfigurationActionable(field, reconfig, state))
  )
  const providersByContextKey = new Map<string, ForkDependentReconfig>()
  for (const field of fields) {
    if (field.providesContextKey) providersByContextKey.set(field.providesContextKey, field)
  }

  const pending = Array.from(actionable)
  for (let index = 0; index < pending.length; index += 1) {
    const field = pending[index]
    if (!field) continue
    for (const contextKey of field.consumesContextKeys) {
      const provider = providersByContextKey.get(contextKey)
      if (!provider || actionable.has(provider)) continue
      actionable.add(provider)
      pending.push(provider)
    }
  }

  return fields.filter((field) => actionable.has(field))
}
