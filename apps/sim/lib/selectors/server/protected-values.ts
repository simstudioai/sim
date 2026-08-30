import type {
  SelectorProtectedValueKind,
  SelectorProtectedValues,
} from '@/lib/selectors/server/types'
import { isNonIdentifyingSecretLiteral } from '@/executor/utils/resolved-secret-match-policy'

export function createSelectorProtectedValues(): SelectorProtectedValues {
  const values = new Map<string, SelectorProtectedValueKind>()
  return {
    add(value, kind = 'secret') {
      if (!value) return
      const current = values.get(value)
      if (current === 'secret') return
      values.set(value, kind)
    },
    contains(value) {
      for (const [protectedValue, kind] of values) {
        if (value === protectedValue) return true
        if (kind === 'secret' || !isNonIdentifyingSecretLiteral(protectedValue)) {
          if (value.includes(protectedValue)) return true
        }
      }
      return false
    },
  }
}
