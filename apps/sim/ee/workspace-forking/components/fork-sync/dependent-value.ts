import type { ForkDependentReconfig } from '@/lib/api/contracts/workspace-fork'

/** In-session dependent values. `null` means an upstream selector invalidated the field. */
export type DependentReconfigState = Record<string, string | null>

/** Stable key for a per-target dependent re-pick (target workflow + block + subblock). */
export function dependentKey(dependent: ForkDependentReconfig): string {
  return `${dependent.targetWorkflowId}:${dependent.targetBlockId}:${dependent.subBlockKey}`
}

function sameDependencyScope(left: ForkDependentReconfig, right: ForkDependentReconfig): boolean {
  return left.dependencyScope === right.dependencyScope
}

/**
 * Index the selector fields that provide each dependency context within a top-level block or
 * nested tool instance. The fork diff has already normalized canonical basic/advanced fields
 * into these context keys, so this is the same graph the selectors use to resolve their options.
 */
function indexContextProviders(
  fields: ForkDependentReconfig[]
): Map<string | undefined, Map<string, ForkDependentReconfig>> {
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
  return providersByScope
}

interface DependentRepickContext {
  /** Effective value displayed immediately before this selection. */
  previousValue: string
  /** Value each field falls back to when it has no in-session override. */
  baselineValueFor: (field: ForkDependentReconfig) => string
}

/**
 * Apply one selector choice and invalidate its transitive descendants within the same dependency
 * scope. Automatic invalidation is represented by `null`, not `''`, so it can be distinguished
 * from a user's intentional clear while the editor is open.
 *
 * Returning a provider to its baseline restores every descendant whose complete provider chain
 * has also returned to baseline. A descendant remains invalidated when another one of its
 * providers is still changed. This makes A -> B -> A a true undo without reviving a value under
 * a genuinely different scope.
 */
export function applyDependentRepick(
  reconfig: DependentReconfigState,
  changedField: ForkDependentReconfig,
  blockFields: ForkDependentReconfig[],
  value: string,
  context: DependentRepickContext
): DependentReconfigState {
  const changedKey = dependentKey(changedField)
  const baselineValue = context.baselineValueFor(changedField)
  const nextState = { ...reconfig }
  if (value === baselineValue) delete nextState[changedKey]
  else nextState[changedKey] = value

  if (context.previousValue === value) return nextState
  if (!changedField.providesContextKey) return nextState

  const pendingContextKeys = [changedField.providesContextKey]
  const visitedFields = new Set([changedKey])
  const descendants: ForkDependentReconfig[] = []
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
      descendants.push(field)
      if (field.providesContextKey) pendingContextKeys.push(field.providesContextKey)
    }
  }

  for (const field of descendants) nextState[dependentKey(field)] = null
  if (value !== baselineValue) return nextState

  const providersByScope = indexContextProviders(blockFields)
  const fieldAndProvidersAtBaseline = (
    field: ForkDependentReconfig,
    visiting: Set<string>
  ): boolean => {
    const fieldKey = dependentKey(field)
    if (visiting.has(fieldKey)) return false
    const fieldValue = nextState[fieldKey]
    const effectiveFieldValue =
      fieldValue === undefined ? context.baselineValueFor(field) : fieldValue
    if (effectiveFieldValue !== context.baselineValueFor(field)) return false

    visiting.add(fieldKey)
    const providers = providersByScope.get(field.dependencyScope)
    const providerChainAtBaseline = field.consumesContextKeys.every((contextKey) => {
      const provider = providers?.get(contextKey)
      return !provider || fieldAndProvidersAtBaseline(provider, visiting)
    })
    visiting.delete(fieldKey)
    return providerChainAtBaseline
  }

  for (let pass = 0; pass < descendants.length; pass += 1) {
    let restored = false
    for (const field of descendants) {
      const fieldKey = dependentKey(field)
      if (nextState[fieldKey] !== null) continue
      const providers = providersByScope.get(field.dependencyScope)
      const providerChainAtBaseline = field.consumesContextKeys.every((contextKey) => {
        const provider = providers?.get(contextKey)
        return !provider || fieldAndProvidersAtBaseline(provider, new Set())
      })
      if (!providerChainAtBaseline) continue
      delete nextState[fieldKey]
      restored = true
    }
    if (!restored) break
  }

  return nextState
}

/**
 * The value sent + displayed for a dependent: the user's in-session re-pick if present, else the
 * stored value (`currentValue`). Blank when the parent target changed in-session, or when an
 * in-block parent re-pick invalidated it, since the old stored value was for the previous parent
 * and won't resolve against the new one. Shared by the sync gate and the per-block selector so
 * the rule cannot drift between them. The payload submits the same effective blank so stale
 * values are removed from top-level fields and nested Agent tool parameters alike.
 */
export function effectiveDependentValue(
  field: ForkDependentReconfig,
  reconfig: DependentReconfigState,
  parentChanged: boolean
): string {
  const repicked = reconfig[dependentKey(field)]
  if (repicked === null) return ''
  if (repicked !== undefined) return repicked
  // A custom block's inputs exist BECAUSE its type was repointed, so `parentChanged` is always
  // true for them — but their stored value IS the user's configuration for that exact target
  // (the storage key namespaces it by target type), not a stale pick against an old parent, so
  // it must survive. The rule lives here rather than at the render site so the displayed value,
  // the Sync gate, and the submitted payload can never disagree about what a field holds.
  if (parentChanged && field.parentKind !== 'custom-block') return ''
  return field.currentValue
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
  reconfig: DependentReconfigState
): string {
  const repicked = reconfig[dependentKey(field)]
  if (repicked === null) return ''
  if (repicked !== undefined) return repicked
  return field.currentValue || field.sourceValue
}

/**
 * Whether an in-block provider change invalidated this field and the user has not re-picked it.
 * It reads and submits as empty while the provider remains changed, preventing a stale top-level
 * or nested Agent tool value from surviving under the new scope.
 */
export function isDependentInvalidated(
  field: ForkDependentReconfig,
  reconfig: DependentReconfigState
): boolean {
  return reconfig[dependentKey(field)] === null
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
 * A field a parent re-pick invalidated reads as blank through `effectiveDependentValue`, so a
 * REQUIRED one stays on screen here and keeps gating Sync. An optional one drops out of the
 * default view - `getDisplayedDependentFields` brings it back under explicit edit mode - and
 * hiding it is safe because the effective blank is still submitted to prevent a stale value.
 */
export function isDependentConfigurationActionable(
  field: ForkDependentReconfig,
  reconfig: DependentReconfigState,
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
  reconfig: DependentReconfigState,
  state: DependentConfigurationState
): ForkDependentReconfig[] {
  const actionable = new Set(
    fields.filter((field) => isDependentConfigurationActionable(field, reconfig, state))
  )
  const providersByScope = indexContextProviders(fields)

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
  reconfig: DependentReconfigState,
  state: DependentConfigurationState,
  showConfigured: boolean
): ForkDependentReconfig[] {
  if (!state.parentResolved) return []
  return showConfigured ? fields : getActionableDependentFields(fields, reconfig, state)
}
