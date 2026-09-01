/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  isNonIdentifyingSecretLiteral,
  MIN_SUBSTITUTABLE_LITERAL_LENGTH,
} from '@/executor/utils/resolved-secret-match-policy'

describe('isNonIdentifyingSecretLiteral', () => {
  it.each(['', '7', '14', 'true', 'false', 'null', 'test', 'hunter2'])(
    'excludes %s, whose value space is too small for a hit to be evidence',
    (literal) => {
      expect(literal.length).toBeLessThan(MIN_SUBSTITUTABLE_LITERAL_LENGTH)
      expect(isNonIdentifyingSecretLiteral(literal)).toBe(true)
    }
  )

  it.each(['hunter22', 'sk_live_abc', '4815162342', 'ffffffffffffffff'])(
    'keeps %s substitutable',
    (literal) => {
      expect(literal.length).toBeGreaterThanOrEqual(MIN_SUBSTITUTABLE_LITERAL_LENGTH)
      expect(isNonIdentifyingSecretLiteral(literal)).toBe(false)
    }
  )

  it('turns on length alone, so a low-entropy full-length credential stays protected', () => {
    expect(isNonIdentifyingSecretLiteral('0'.repeat(MIN_SUBSTITUTABLE_LITERAL_LENGTH))).toBe(false)
    expect(isNonIdentifyingSecretLiteral('0'.repeat(MIN_SUBSTITUTABLE_LITERAL_LENGTH - 1))).toBe(
      true
    )
  })
})
