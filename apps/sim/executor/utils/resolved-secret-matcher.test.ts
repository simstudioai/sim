/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createResolvedSecretMatcher,
  OPAQUE_RESOLVED_SECRET_REPLACEMENT,
  sanitizeResolvedSecretPrimitive,
  sanitizeResolvedSecretString,
} from '@/executor/utils/resolved-secret-matcher'

describe('resolved secret matcher', () => {
  it('uses exact matching for typed primitive renderings', () => {
    const matcher = createResolvedSecretMatcher([{ plaintext: '23', replacement: '{{TOKEN}}' }])

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretPrimitive('23', matcher)).toBe('{{TOKEN}}')
    expect(sanitizeResolvedSecretPrimitive('123', matcher)).toBeUndefined()
    expect(sanitizeResolvedSecretString('123', matcher)).toBe('1{{TOKEN}}')
  })

  it('sanitizes short inputs with a maximum-length catalog literal', () => {
    const plaintext = 'x'.repeat(64 * 1024)
    const matcher = createResolvedSecretMatcher([{ plaintext, replacement: '{{TOKEN}}' }])

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('ok', matcher)).toBe('ok')
    expect(sanitizeResolvedSecretString(plaintext, matcher)).toBe('{{TOKEN}}')
  })

  it('uses an opaque marker when a named replacement contains its own plaintext', () => {
    const matcher = createResolvedSecretMatcher([{ plaintext: 'Test', replacement: '{{Test}}' }])

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('Test', matcher)).toBe(OPAQUE_RESOLVED_SECRET_REPLACEMENT)
  })

  it('fails safely when the opaque marker contains another active secret', () => {
    const matcher = createResolvedSecretMatcher([
      { plaintext: 'Test', replacement: '{{Test}}' },
      { plaintext: 'REDACTED', replacement: '{{OTHER}}' },
    ])

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('Test', matcher)).toBe('')
  })
})
