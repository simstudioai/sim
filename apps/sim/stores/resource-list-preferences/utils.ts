import type { ResourceListPreference } from '@/stores/resource-list-preferences/types'

export function resourceListPreferencesEqual(
  left: ResourceListPreference,
  right: ResourceListPreference
): boolean {
  if (left.sort.column !== right.sort.column || left.sort.direction !== right.sort.direction) {
    return false
  }

  const leftFilterKeys = Object.keys(left.filters)
  const rightFilterKeys = Object.keys(right.filters)
  if (leftFilterKeys.length !== rightFilterKeys.length) return false

  return leftFilterKeys.every((key) => {
    const leftValues = left.filters[key]
    const rightValues = right.filters[key]
    return (
      Array.isArray(rightValues) &&
      leftValues.length === rightValues.length &&
      leftValues.every((value, index) => value === rightValues[index])
    )
  })
}
