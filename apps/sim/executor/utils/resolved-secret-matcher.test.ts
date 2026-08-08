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
      { plaintext: 'x', replacement: '{{SHORT}}' },
      { plaintext: 'xx', replacement: '{{OVERLAP}}' },
      { plaintext: 'abc', replacement: '{{PREFIX}}' },
      { plaintext: 'bc', replacement: '{{SUFFIX}}' },
    ])
    const matches: string[] = []

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(
      scanResolvedSecretString(
        `${'x'.repeat(1_000_001)}abcabc`,
        matcher,
        (match) => matches.push(match),
        4
      )
    ).toBe(4)
    expect(matches).toEqual(['x', 'xx', 'abc', 'bc'])
  })

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

  it('uses opaque model-safe replacements by default when a label contains plaintext', () => {
    const matcher = createResolvedSecretMatcher([{ plaintext: 'Test', replacement: '{{Test}}' }])

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('Test', matcher)).toBe(OPAQUE_RESOLVED_SECRET_REPLACEMENT)
  })

  it('preserves matcher-issued placeholders for user-visible provenance', () => {
    const matcher = createResolvedSecretMatcher(
      [{ plaintext: 'Test', replacement: '{{Test}}' }],
      PRESERVE_NAMED_PROVENANCE
    )

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('Test', matcher)).toBe('{{Test}}')
    expect(sanitizeResolvedSecretString('{{Test}}', matcher)).toBe('{{Test}}')
    expect(sanitizeResolvedSecretString('Test {{Test}} Test', matcher)).toBe(
      '{{Test}} {{Test}} {{Test}}'
    )
    expect(containsResolvedSecret('{{Test}}', matcher)).toBe(false)
    expect(containsResolvedSecret('{{Test}} Test', matcher)).toBe(true)
  })

  it.each(['123TOKEN', 'API-KEY', 'LEGACY KEY'])(
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

  it.each(['{{Test{B}}}', '{{Test}}B}}'])(
    'fails closed for malformed provenance label %s',
    (replacement) => {
      const matcher = createResolvedSecretMatcher(
        [{ plaintext: 'Test', replacement }],
        PRESERVE_NAMED_PROVENANCE
      )

      expect(matcher).toBeDefined()
      if (!matcher) return
      expect(sanitizeResolvedSecretString('Test', matcher)).toBe(OPAQUE_RESOLVED_SECRET_REPLACEMENT)
    }
  )

  it('reports protected-token matches to provenance callbacks', () => {
    const matcher = createResolvedSecretMatcher(
      [{ plaintext: 'Test', replacement: '{{Test}}' }],
      PRESERVE_NAMED_PROVENANCE
    )
    const matches: string[] = []

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(
      sanitizeResolvedSecretString('{{Test}}', matcher, undefined, (plaintext) =>
        matches.push(plaintext)
      )
    ).toBe('{{Test}}')
    expect(matches).toEqual(['Test'])
  })

  it('keeps malformed placeholder-like input linear and still projects trailing plaintext', () => {
    const matcher = createResolvedSecretMatcher(
      [{ plaintext: 'Test', replacement: '{{Test}}' }],
      PRESERVE_NAMED_PROVENANCE
    )
    const malformedPrefix = '{'.repeat(100_000)

    expect(matcher).toBeDefined()
    if (!matcher) return
    const sanitized = sanitizeResolvedSecretString(`${malformedPrefix}Test`, matcher)
    expect(sanitized.length).toBe(malformedPrefix.length + '{{Test}}'.length)
    expect(sanitized.endsWith('{{Test}}')).toBe(true)
  })

  it('still replaces secrets that extend beyond a protected placeholder', () => {
    const matcher = createResolvedSecretMatcher(
      [
        { plaintext: 'x{{Test}}y', replacement: '{{COMPOSITE}}' },
        { plaintext: 'Test', replacement: '{{Test}}' },
      ],
      PRESERVE_NAMED_PROVENANCE
    )

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('x{{Test}}y', matcher)).toBe('{{COMPOSITE}}')
    expect(containsResolvedSecret('x{{Test}}y', matcher)).toBe(true)
  })

  it('uses the opaque fallback for unsafe non-placeholder replacements', () => {
    const matcher = createResolvedSecretMatcher([
      { plaintext: 'Test', replacement: 'visible-Test' },
    ])

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('Test', matcher)).toBe(OPAQUE_RESOLVED_SECRET_REPLACEMENT)
  })

  it('does not protect another secret merely because it occurs inside a named placeholder', () => {
    const matcher = createResolvedSecretMatcher(
      [
        { plaintext: 'Test', replacement: '{{Test}}' },
        { plaintext: '{', replacement: '{{BRACE}}' },
      ],
      PRESERVE_NAMED_PROVENANCE
    )

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('Test', matcher)).toBe(OPAQUE_RESOLVED_SECRET_REPLACEMENT)
    expect(sanitizeResolvedSecretString('{', matcher)).toBe('{{BRACE}}')
  })

  it('fails safely when the opaque fallback contains another active secret', () => {
    const matcher = createResolvedSecretMatcher([
      { plaintext: 'Test', replacement: 'visible-Test' },
      { plaintext: 'REDACTED', replacement: '{{OTHER}}' },
    ])

    expect(matcher).toBeDefined()
    if (!matcher) return
    expect(sanitizeResolvedSecretString('Test', matcher)).toBe('')
  })
})
