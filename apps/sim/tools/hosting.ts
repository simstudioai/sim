import type { ToolHostingCondition, ToolHostingPredicate } from '@/tools/types'

/**
 * Defines conditional hosted-key eligibility once for both runtime evaluation
 * and the machine-readable VFS auth contract.
 */
export function hostedKeyEnabledWhen<P>(condition: ToolHostingCondition): ToolHostingPredicate<P> {
  const predicate = ((params: P) => {
    const value = (params as unknown as Record<string, unknown>)[condition.field]
    if (condition.operator === 'equals') return value === condition.value
    return condition.values.includes(value as string | number | boolean | null)
  }) as ToolHostingPredicate<P>

  predicate.condition = condition
  return predicate
}
