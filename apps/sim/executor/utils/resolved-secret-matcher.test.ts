/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  containsResolvedSecret,
  createResolvedSecretMatcher,
  OPAQUE_RESOLVED_SECRET_REPLACEMENT,
  sanitizeResolvedSecretPrimitive,
  sanitizeResolvedSecretString,
  scanResolvedSecretString,
} from '@/executor/utils/resolved-secret-matcher'

const PRESERVE_NAMED_PROVENANCE = { preserveNamedProvenanceLabels: true } as const

describe('resolved secret matcher', () => {
  it('reports each matched literal once across large repeated content', () => {
    const matcher = createResolvedSecretMatcher([
      { plaintext: 'xxxxxxxx', replacement: '{{SHORT}}' },
      { plaintext: 'xxxxxxxxx', replacement: '{{OVERLAP}}' },
      { plaintext: 'abcdefgh', replacement: '{{PREFIX}}' },
      { plaintext: 'bcdefghi', replacement: '{{SUFFIX}}' },
    ])
    const matches: string[] = []

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(
      scanResolvedSecretString(
        `${'x'.repeat(1_000_001)}abcdefghiabcdefghi`,
        matcher,
        (match) => matches.push(match),
        4
      )
    ).toBe(4)
    expect(matches).toEqual(['xxxxxxxx', 'xxxxxxxxx', 'abcdefgh', 'bcdefghi'])
  })

  it('uses exact matching for typed primitive renderings', () => {
    const matcher = createResolvedSecretMatcher([
      { plaintext: '23456789', replacement: '{{TOKEN}}' },
    ])

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretPrimitive('23456789', matcher)).toBe('{{TOKEN}}')
    expect(sanitizeResolvedSecretPrimitive('123456789', matcher)).toBeUndefined()
    expect(sanitizeResolvedSecretString('123456789', matcher)).toBe('1{{TOKEN}}')
  })

  it('sanitizes short inputs with a maximum-length catalog literal', () => {
    const plaintext = 'x'.repeat(64 * 1024)
    const matcher = createResolvedSecretMatcher([{ plaintext, replacement: '{{TOKEN}}' }])

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('ok', matcher)).toBe('ok')
    expect(sanitizeResolvedSecretString(plaintext, matcher)).toBe('{{TOKEN}}')
  })

  it('uses opaque model-safe replacements by default when a label contains plaintext', () => {
    const matcher = createResolvedSecretMatcher([
      { plaintext: 'TestValue', replacement: '{{TestValue}}' },
    ])

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('TestValue', matcher)).toBe(
      OPAQUE_RESOLVED_SECRET_REPLACEMENT
    )
  })

  it('preserves matcher-issued placeholders for user-visible provenance', () => {
    const matcher = createResolvedSecretMatcher(
      [{ plaintext: 'TestValue', replacement: '{{TestValue}}' }],
      PRESERVE_NAMED_PROVENANCE
    )

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('TestValue', matcher)).toBe('{{TestValue}}')
    expect(sanitizeResolvedSecretString('{{TestValue}}', matcher)).toBe('{{TestValue}}')
    expect(sanitizeResolvedSecretString('TestValue {{TestValue}} TestValue', matcher)).toBe(
      '{{TestValue}} {{TestValue}} {{TestValue}}'
    )
    expect(containsResolvedSecret('{{TestValue}}', matcher)).toBe(false)
    expect(containsResolvedSecret('{{TestValue}} TestValue', matcher)).toBe(true)
  })

  it.each(['123TOKEN', 'API-KEY-1', 'LEGACY KEY'])(
    'preserves matcher-issued placeholders for supported legacy name %s',
    (name) => {
      const matcher = createResolvedSecretMatcher(
        [{ plaintext: name, replacement: `{{${name}}}` }],
        PRESERVE_NAMED_PROVENANCE
      )

      expect(matcher).toBeDefined()
      if (!matcher) return
      expect(sanitizeResolvedSecretString(name, matcher)).toBe(`{{${name}}}`)
      expect(sanitizeResolvedSecretString(`{{${name}}}`, matcher)).toBe(`{{${name}}}`)
    }
  )

  it.each(['{{TestValue{B}}}', '{{TestValue}}B}}'])(
    'fails closed for malformed provenance label %s',
    (replacement) => {
      const matcher = createResolvedSecretMatcher(
        [{ plaintext: 'TestValue', replacement }],
        PRESERVE_NAMED_PROVENANCE
      )

      expect(matcher).toBeDefined()
      if (!matcher) return
      expect(sanitizeResolvedSecretString('TestValue', matcher)).toBe(
        OPAQUE_RESOLVED_SECRET_REPLACEMENT
      )
    }
  )

  it('reports protected-token matches to provenance callbacks', () => {
    const matcher = createResolvedSecretMatcher(
      [{ plaintext: 'TestValue', replacement: '{{TestValue}}' }],
      PRESERVE_NAMED_PROVENANCE
    )
    const matches: string[] = []

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(
      sanitizeResolvedSecretString('{{TestValue}}', matcher, undefined, (plaintext) =>
        matches.push(plaintext)
      )
    ).toBe('{{TestValue}}')
    expect(matches).toEqual(['TestValue'])
  })

  it('keeps malformed placeholder-like input linear and still projects trailing plaintext', () => {
    const matcher = createResolvedSecretMatcher(
      [{ plaintext: 'TestValue', replacement: '{{TestValue}}' }],
      PRESERVE_NAMED_PROVENANCE
    )
    const malformedPrefix = '{'.repeat(100_000)

    expect(matcher).toBeDefined()
    if (!matcher) return
    const sanitized = sanitizeResolvedSecretString(`${malformedPrefix}TestValue`, matcher)
    expect(sanitized.length).toBe(malformedPrefix.length + '{{TestValue}}'.length)
    expect(sanitized.endsWith('{{TestValue}}')).toBe(true)
  })

  it('still replaces secrets that extend beyond a protected placeholder', () => {
    const matcher = createResolvedSecretMatcher(
      [
        { plaintext: 'x{{TestValue}}y', replacement: '{{COMPOSITE}}' },
        { plaintext: 'TestValue', replacement: '{{TestValue}}' },
      ],
      PRESERVE_NAMED_PROVENANCE
    )

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('x{{TestValue}}y', matcher)).toBe('{{COMPOSITE}}')
    expect(containsResolvedSecret('x{{TestValue}}y', matcher)).toBe(true)
  })

  it('uses the opaque fallback for unsafe non-placeholder replacements', () => {
    const matcher = createResolvedSecretMatcher([
      { plaintext: 'TestValue', replacement: 'visible-TestValue' },
    ])

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('TestValue', matcher)).toBe(
      OPAQUE_RESOLVED_SECRET_REPLACEMENT
    )
  })

  it('does not protect another secret merely because it occurs inside a named placeholder', () => {
    const matcher = createResolvedSecretMatcher(
      [
        { plaintext: 'TestValue', replacement: '{{TestValue}}' },
        { plaintext: '{{TestVa', replacement: '{{BRACE}}' },
      ],
      PRESERVE_NAMED_PROVENANCE
    )

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('TestValue', matcher)).toBe(
      OPAQUE_RESOLVED_SECRET_REPLACEMENT
    )
    expect(sanitizeResolvedSecretString('{{TestVa', matcher)).toBe('{{BRACE}}')
  })

  it('fails safely when the opaque fallback contains another active secret', () => {
    const matcher = createResolvedSecretMatcher([
      { plaintext: 'TestValue', replacement: 'visible-TestValue' },
      { plaintext: 'REDACTED', replacement: '{{OTHER}}' },
    ])

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('TestValue', matcher)).toBe('')
  })
})
