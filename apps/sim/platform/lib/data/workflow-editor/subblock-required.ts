import type { SubBlockConfig } from '@/blocks/types'

type RequirementValue = string | number | boolean | Array<string | number | boolean> | undefined

interface RequirementCondition {
  field: string
  value: RequirementValue
  not?: boolean
  and?: { field: string; value: RequirementValue; not?: boolean }
}

function matches(fieldValue: unknown, expected: RequirementValue, not?: boolean): boolean {
  const match = Array.isArray(expected)
    ? expected.includes(fieldValue as string | number | boolean)
    : fieldValue === expected
  return not ? !match : match
}

/**
 * Whether a sub-block must be filled, resolving a conditional requirement against its siblings'
 * flat values the way the legacy editor's label does.
 */
export function isFieldRequired(config: SubBlockConfig, values?: Record<string, unknown>): boolean {
  if (!config.required) return false
  if (typeof config.required === 'boolean') return config.required
  const condition = (
    typeof config.required === 'function' ? config.required(values ?? {}) : config.required
  ) as RequirementCondition
  const flat = values ?? {}
  let match = matches(flat[condition.field], condition.value, condition.not)
  if (condition.and) {
    match = match && matches(flat[condition.and.field], condition.and.value, condition.and.not)
  }
  return match
}
