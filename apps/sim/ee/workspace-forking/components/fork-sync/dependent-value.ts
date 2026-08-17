import type { ForkDependentReconfig } from '@/lib/api/contracts/workspace-fork'

/** Stable key for a per-target dependent re-pick (target workflow + block + subblock). */
export function dependentKey(dependent: ForkDependentReconfig): string {
  return `${dependent.targetWorkflowId}:${dependent.targetBlockId}:${dependent.subBlockKey}`
}

function sameDependencyScope(left: ForkDependentReconfig, right: ForkDependentReconfig): boolean {
  return left.dependencyScope === right.dependencyScope
}

/**
 * Store a dependent re-pick and clear every selector transitively scoped by it. Empty-string
 * overrides are intentional: an absent override means "fall back to the stored value", while a
 * changed provider makes every stored descendant stale for both mapped and copied parents.
 */
export function applyDependentRepick(
  reconfig: Record<string, string>,
  changedField: ForkDependentReconfig,
  blockFields: ForkDependentReconfig[],
  value: string
): Record<string, string> {
  const changedKey = dependentKey(changedField)
  const nextState = { ...reconfig, [changedKey]: value }
  if (!changedField.providesContextKey) return nextState

  const pendingContextKeys = [changedField.providesContextKey]
  const visitedFields = new Set([changedKey])
  for (let index = 0; index < pendingContextKeys.length; index += 1) {
    const contextKey = pendingContextKeys[index]
    if (!contextKey) continue

    for (const field of blockFields) {
      const fieldKey = dependentKey(field)
      if (
        !sameDependencyScope(changedField, field) ||
        visitedFields.has(fieldKey) ||
        !field.consumesContextKeys.includes(contextKey)
      ) {
        continue
      }

      visitedFields.add(fieldKey)
      nextState[fieldKey] = ''
      if (field.providesContextKey) pendingContextKeys.push(field.providesContextKey)
    }
  }

  return nextState
}

/**
 * The value sent + displayed for a dependent: the user's in-session re-pick if present, else the
 * stored value (`currentValue`). Blank when the parent target changed in-session, since the old
 * stored value was for the previous parent and won't resolve against the new one. Shared by the
 * sync gate + payload build and the per-block selector so the rule can't drift between them.
 */
export function effectiveDependentValue(
  field: ForkDependentReconfig,
  reconfig: Record<string, string>,
  parentChanged: boolean
): string {
  const repicked = reconfig[dependentKey(field)]
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
  if (repicked !== undefined) return repicked
  return field.currentValue || field.sourceValue
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
 */
export function isDependentConfigurationActionable(
  field: ForkDependentReconfig,
  reconfig: Record<string, string>,
  state: DependentConfigurationState
): boolean {
  if (!state.parentResolved) return false
  if (state.parentChanged || state.copying) return true
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
  const providersByScope = new Map<string | undefined, Map<string, ForkDependentReconfig>>()
  for (const field of fields) {
    if (!field.providesContextKey) continue
    let providers = providersByScope.get(field.dependencyScope)
    if (!providers) {
      providers = new Map()
      providersByScope.set(field.dependencyScope, providers)
    }
    providers.set(field.providesContextKey, field)
  }

  const pending = Array.from(actionable)
  for (let index = 0; index < pending.length; index += 1) {
    const field = pending[index]
    if (!field) continue
    for (const contextKey of field.consumesContextKeys) {
      const provider = providersByScope.get(field.dependencyScope)?.get(contextKey)
      if (!provider || actionable.has(provider)) continue
      actionable.add(provider)
      pending.push(provider)
    }
  }

  return fields.filter((field) => actionable.has(field))
}

/**
 * Fields rendered in the mapping UI. Required missing fields remain visible by default; an
 * explicit edit action reveals every active selector under a resolved parent without changing
 * which fields gate Sync.
 */
export function getDisplayedDependentFields(
  fields: ForkDependentReconfig[],
  reconfig: Record<string, string>,
  state: DependentConfigurationState,
  showConfigured: boolean
): ForkDependentReconfig[] {
  if (!state.parentResolved) return []
  return showConfigured ? fields : getActionableDependentFields(fields, reconfig, state)
}
