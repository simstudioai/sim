import type { ForkDependentReconfig } from '@/lib/api/contracts/workspace-fork'

/** Stable key for a per-target dependent re-pick (target workflow + block + subblock). */
export function dependentKey(dependent: ForkDependentReconfig): string {
  return `${dependent.targetWorkflowId}:${dependent.targetBlockId}:${dependent.subBlockKey}`
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
