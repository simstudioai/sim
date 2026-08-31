import type {
  SelectorProtectedValueKind,
  SelectorProtectedValues,
} from '@/lib/selectors/server/types'
import { isNonIdentifyingSecretLiteral } from '@/executor/utils/resolved-secret-match-policy'

export function createSelectorProtectedValues(): SelectorProtectedValues {
  const values = new Map<string, SelectorProtectedValueKind>()

  function contains(value: string, allowedExactValue?: string): boolean {
    for (const [protectedValue, kind] of values) {
      if (value === protectedValue) {
        if (protectedValue !== allowedExactValue) return true
        continue
      }
      if (kind === 'secret' || !isNonIdentifyingSecretLiteral(protectedValue)) {
        if (value.includes(protectedValue)) return true
      }
    }
    return false
  }

  return {
    add(value, kind = 'secret') {
      if (!value) return
      const current = values.get(value)
      if (current === 'secret') return
      values.set(value, kind)
    },
    contains: (value) => contains(value),
    containsExceptExact: (value, allowedExactValue) => contains(value, allowedExactValue),
  }
}
