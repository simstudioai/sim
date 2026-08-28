import type { SelectorProtectedValues } from '@/lib/selectors/server/types'

export function createSelectorProtectedValues(): SelectorProtectedValues {
  const values = new Set<string>()
  return {
    add(value) {
      if (value) values.add(value)
    },
    contains(value) {
      for (const protectedValue of values) {
        if (value.includes(protectedValue)) return true
      }
      return false
    },
  }
}
