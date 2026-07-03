import type { ForkDependentReconfig } from '@/lib/api/contracts/workspace-fork'

/** Stable key for a per-target dependent re-pick (target workflow + block + subblock). */
export function dependentKey(dependent: ForkDependentReconfig): string {
  return `${dependent.targetWorkflowId}:${dependent.targetBlockId}:${dependent.subBlockKey}`
}

/**
 * The value sent + displayed for a dependent: the user's in-session re-pick if present, else the
 * stored value (`currentValue`). Blank when the parent target changed in-session, since the old
 * stored value was for the previous parent and won't resolve against the new one. Shared by the
 * modal (gate + payload) and the per-block selector so the rule can't drift between them.
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
