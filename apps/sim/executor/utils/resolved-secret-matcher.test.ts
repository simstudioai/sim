/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type CreateResolvedSecretMatcherOptions,
  containsResolvedSecret,
  createResolvedSecretMatcher,
  OPAQUE_RESOLVED_SECRET_REPLACEMENT,
  type ResolvedSecretMatch,
  type ResolvedSecretMatcher,
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

describe('resolved secret matcher match policy', () => {
  const SHORT = [{ plaintext: 'test', replacement: '{{TOKEN}}' }]
  const API_KEY = 'sk-proj-Ab3xK9mQ2pLw7nRt5vYc8Zd4'
  const LONG = [{ plaintext: API_KEY, replacement: '{{API_KEY}}' }]

  function build(
    matches: ResolvedSecretMatch[],
    options?: CreateResolvedSecretMatcherOptions
  ): ResolvedSecretMatcher {
    const matcher = createResolvedSecretMatcher(matches, options)
    if (!matcher) throw new Error('expected a matcher')
    return matcher
  }

  it('matches a short literal anywhere when classifying content', () => {
    const matcher = build(SHORT)

    expect(containsResolvedSecret('the latest news', matcher)).toBe(true)
    expect(sanitizeResolvedSecretString('the latest news', matcher)).toBe('the la{{TOKEN}} news')
  })

  it.each([
    ['test', '{{TOKEN}}'],
    ['key=test', 'key={{TOKEN}}'],
    ['"test"', '"{{TOKEN}}"'],
    ['{"k":"test"}', '{"k":"{{TOKEN}}"}'],
    ['test test', '{{TOKEN}} {{TOKEN}}'],
    ['user_test_id', 'user_{{TOKEN}}_id'],
  ])('still renders a boundary-anchored short literal in %s', (value, expected) => {
    const matcher = build(SHORT, { mode: 'render' })

    expect(sanitizeResolvedSecretString(value, matcher)).toBe(expected)
    expect(containsResolvedSecret(value, matcher)).toBe(true)
  })

  it.each(['the latest news', 'tested', 'prefixtest'])(
    'leaves an unanchored short literal in %s untouched when rendering',
    (value) => {
      const matcher = build(SHORT, { mode: 'render' })

      expect(sanitizeResolvedSecretString(value, matcher)).toBe(value)
      expect(containsResolvedSecret(value, matcher)).toBe(false)
    }
  )

  it('renders a full-length literal at any offset, including mid-token', () => {
    const matcher = build(LONG, { mode: 'render' })

    expect(sanitizeResolvedSecretString(`prefix${API_KEY}suffix`, matcher)).toBe(
      'prefix{{API_KEY}}suffix'
    )
    expect(containsResolvedSecret(`prefix${API_KEY}suffix`, matcher)).toBe(true)
  })

  /** Prefixed shapes are assembled at runtime so no source literal reads as a live credential. */
  it.each([
    ['f'.repeat(32), 'all-f HMAC key'],
    ['4111111111111111', 'test PAN'],
    [`AKIA${'0'.repeat(16)}`, 'padded AWS key id'],
    [`sk_live_${'0'.repeat(24)}`, 'padded stripe-style key'],
  ])('renders low-variety full-length credential (%s) mid-token', (secret) => {
    const matcher = build([{ plaintext: secret, replacement: '{{KEY}}' }], { mode: 'render' })

    expect(sanitizeResolvedSecretString(`etag_${secret}x`, matcher)).toBe('etag_{{KEY}}x')
    expect(containsResolvedSecret(`etag_${secret}x`, matcher)).toBe(true)
  })

  it('settles a boundary that an earlier substitution exposed', () => {
    const matcher = build(
      [
        { plaintext: API_KEY, replacement: '{{API_KEY}}' },
        { plaintext: 'test', replacement: '{{TOKEN}}' },
      ],
      { mode: 'render' }
    )

    expect(sanitizeResolvedSecretString(`${API_KEY}test`, matcher)).toBe('{{API_KEY}}{{TOKEN}}')
  })

  it('settles a literal that an empty replacement spliced into existence', () => {
    const matcher = build([
      { plaintext: API_KEY, replacement: '' },
      { plaintext: 'password', replacement: '{{PW}}' },
    ])

    expect(sanitizeResolvedSecretString(`pass${API_KEY}word`, matcher)).toBe('{{PW}}')
  })

  it('keeps the substitution pass and its invariant in agreement', () => {
    const matcher = build(SHORT, { mode: 'render' })

    for (const value of ['the latest news', 'key=test', 'contest testable test']) {
      const sanitized = sanitizeResolvedSecretString(value, matcher)
      expect(containsResolvedSecret(sanitized, matcher)).toBe(false)
    }
  })

  it('reports a suppressed match to provenance callbacks so detection stays conservative', () => {
    const matcher = build(SHORT, { mode: 'render' })
    const matches: string[] = []

    expect(
      sanitizeResolvedSecretString('the latest news', matcher, undefined, (plaintext) =>
        matches.push(plaintext)
      )
    ).toBe('the latest news')
    expect(matches).toEqual(['test'])
  })

  it.each([
    ['Test', '{{Test}}'],
    ['{{Test}}', '{{Test}}'],
    ['Test {{Test}} Test', '{{Test}} {{Test}} {{Test}}'],
    ['laTest news', 'laTest news'],
  ])('preserves named provenance labels under the render policy for %s', (value, expected) => {
    const matcher = build([{ plaintext: 'Test', replacement: '{{Test}}' }], {
      ...PRESERVE_NAMED_PROVENANCE,
      mode: 'render',
    })

    expect(sanitizeResolvedSecretString(value, matcher)).toBe(expected)
  })

  it('keeps the protected-placeholder behaviours under the options production uses', () => {
    const composite = build(
      [
        { plaintext: 'x{{Test}}y', replacement: '{{COMPOSITE}}' },
        { plaintext: 'Test', replacement: '{{Test}}' },
      ],
      { ...PRESERVE_NAMED_PROVENANCE, mode: 'render' }
    )
    expect(sanitizeResolvedSecretString('x{{Test}}y', composite)).toBe('{{COMPOSITE}}')

    const malformed = build([{ plaintext: 'Test', replacement: '{{Test{B}}}' }], {
      ...PRESERVE_NAMED_PROVENANCE,
      mode: 'render',
    })
    expect(sanitizeResolvedSecretString('Test', malformed)).toBe(OPAQUE_RESOLVED_SECRET_REPLACEMENT)

    const chained = build(
      [
        { plaintext: 'Test', replacement: 'visible-Test' },
        { plaintext: 'REDACTED', replacement: '{{OTHER}}' },
      ],
      { mode: 'render' }
    )
    expect(sanitizeResolvedSecretString('Test', chained)).toBe('')
  })

  it('keeps exact replacement available below the length floor', () => {
    const matcher = build([{ plaintext: '23', replacement: '{{TOKEN}}' }], { mode: 'render' })

    expect(sanitizeResolvedSecretPrimitive('23', matcher)).toBe('{{TOKEN}}')
    expect(sanitizeResolvedSecretString('23', matcher)).toBe('{{TOKEN}}')
    expect(sanitizeResolvedSecretString('123', matcher)).toBe('123')
  })

  it('builds a matcher for an astral-plane literal instead of failing construction', () => {
    const secret = 'k\u{1F600}ey12345'
    const matcher = build([{ plaintext: secret, replacement: '{{EMOJI}}' }], { mode: 'render' })

    expect(sanitizeResolvedSecretString(`token ${secret} end`, matcher)).toBe('token {{EMOJI}} end')
  })

  it('does not rewrite a token interior next to an astral-plane letter', () => {
    const matcher = build(SHORT, { mode: 'render' })

    expect(sanitizeResolvedSecretString('\u{1D400}test\u{1D401}', matcher)).toBe(
      '\u{1D400}test\u{1D401}'
    )
  })
})
