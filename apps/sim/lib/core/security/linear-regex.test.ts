import { describe, expect, it } from 'vitest'
import {
  compileLinearRegex,
  compileLookaroundSplit,
  isPlainText,
  literalRegex,
} from '@/lib/core/security/linear-regex'

/**
 * Patterns that take exponential time on a backtracking engine. `a*a*b` is the
 * important one: it defeats `safe-regex2`'s star-height screen and a
 * quantified-group screen alike, and measured 213s on JSC / 132s on V8 against
 * the input below.
 */
const CATASTROPHIC = ['(a+)+$', '(a|a)*b', 'a*a*b', '(x+x+)+y', '(\\w+\\s?)*$', '^(\\d+)*$']

describe('compileLinearRegex', () => {
  it.each(CATASTROPHIC)('matches %s in linear time on adversarial input', (pattern) => {
    const regex = compileLinearRegex(pattern)
    expect(regex).not.toBeNull()

    const adversarial = `${'a'.repeat(50000)}!`
    const start = Date.now()
    regex?.test(adversarial)
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it('honours ignoreCase only when asked', () => {
    expect(compileLinearRegex('ERROR', { ignoreCase: true })?.test('an error here')).toBe(true)
    expect(compileLinearRegex('ERROR')?.test('an error here')).toBe(false)
  })

  it.each([
    ['non-breaking space', '\u00a0'],
    ['line separator', '\u2028'],
    ['vertical tab', '\v'],
  ])('treats %s as whitespace, matching the built-in engine', (_label, ws) => {
    // RE2's own \\s is ASCII-only. Untranslated, a \\s document splitter stops
    // splitting on the whitespace that PDF/HTML extraction emits, silently
    // changing stored chunk boundaries.
    const doc = `alpha${ws}beta`
    expect(compileLinearRegex('\\s+')?.split(doc)).toEqual(doc.split(/\s+/g))
    expect(compileLinearRegex('\\s')?.test(doc)).toBe(true)
  })

  it.each([
    ['lookahead', '(?=foo)bar'],
    ['lookbehind', '(?<=id: )\\w+'],
    ['backreference', '(ab)\\1'],
    ['invalid syntax', '('],
  ])('returns null for %s so the caller must choose how to degrade', (_label, pattern) => {
    expect(compileLinearRegex(pattern)).toBeNull()
  })
})

describe('literalRegex', () => {
  it('is unaffected by repeated calls (no lastIndex carry-over)', () => {
    const regex = literalRegex('needle')
    const text = 'needle here and needle again'
    expect([regex.test(text), regex.test(text), regex.test(text)]).toEqual([true, true, true])
    expect([regex.find(text), regex.find(text)]).toEqual([0, 0])
  })

  it('matches case-insensitively when asked', () => {
    expect(literalRegex('Needle', { ignoreCase: true }).test('a NEEDLE')).toBe(true)
    expect(literalRegex('Needle').test('a NEEDLE')).toBe(false)
  })
})

describe('isPlainText / escapeRegExp', () => {
  it.each(['timeout', 'ECONNREFUSED', 'status=503', 'GET /api/logs'])(
    'treats %s as plain text',
    (pattern) => expect(isPlainText(pattern)).toBe(true)
  )

  it.each(['example.com', 'a+b', '^x', '(a|b)', '[abc]'])(
    'treats %s as containing metacharacters',
    (pattern) => expect(isPlainText(pattern)).toBe(false)
  )

  it.each(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'])(
    'escapes %s so a literal pattern matches only itself',
    (meta) => {
      const regex = literalRegex(`a${meta}b`)
      expect(regex.test(`a${meta}b`)).toBe(true)
      // Under-escaping shows up here: an unescaped metacharacter would let the
      // pattern match text that does not contain it verbatim.
      expect(regex.test('aXb')).toBe(false)
      expect(regex.test('ab')).toBe(false)
    }
  )
})

describe('compileLookaroundSplit', () => {
  it('keeps split independent of its object receiver', () => {
    const doc = '# One\nalpha\n# Two\nbeta'
    const { split } = compileLookaroundSplit('(?=#\\s)')!

    expect(split(doc)).toEqual(doc.split(/(?=#\s)/g).filter(Boolean))
    expect([doc, doc].map(split)).toEqual([
      doc.split(/(?=#\s)/g).filter(Boolean),
      doc.split(/(?=#\s)/g).filter(Boolean),
    ])
  })

  it('stays linear on a catastrophic body', () => {
    const regex = compileLookaroundSplit('(?=a*a*b)')
    expect(regex).not.toBeNull()

    const start = Date.now()
    regex?.split(`${'a'.repeat(20000)}!`)
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it.each([
    ['negative lookahead', '(?!x)y'],
    ['negative lookbehind', '(?<!a)b'],
    ['backreference', '(?<=x)(a)\\1'],
    ['plain pattern', '\\n\\n'],
  ])('returns null for %s', (_label, pattern) => {
    expect(compileLookaroundSplit(pattern)).toBeNull()
  })

  it.each([
    ['leading assertion', '(?<=\\.)\\s+|\\n\\n'],
    ['empty middle', '(?<=</p>)|<hr>'],
    ['trailing assertion', 'a|b(?=c)'],
  ])('rejects %s with top-level alternation rather than reshaping it', (_label, pattern) => {
    // `(?<=X)A|B` means `((?<=X)A)|B`; rebuilt as `(?:X)(A|B)` it would demand
    // the assertion before both branches. No grouping recovers that, so the
    // only correct answer is to decline the pattern.
    expect(compileLookaroundSplit(pattern)).toBeNull()
  })

  it('is unaffected by a capturing group inside the lookbehind', () => {
    // The middle is captured by name, so group numbering cannot shift.
    expect(compileLookaroundSplit('(?<=(a))b')?.split('xaby')).toEqual(['xa', 'y'])

    const optional = compileLookaroundSplit('(?<=(a)|b)c')
    expect(optional?.find('bc')).toBe(1)
    expect(optional?.test('bc')).toBe(true)
  })
})

/**
 * Differential test: every pattern the linear engine accepts must behave like
 * the built-in engine.
 *
 * Every defect found in this module has been a silent semantic divergence, not
 * a crash — `\s` losing Unicode whitespace, a decomposed lookaround binding to
 * the wrong alternation branch, a consumed lookahead swallowing boundaries.
 * Each was caught by comparing engines over a corpus, and each would have
 * shipped otherwise, because the code was self-consistent and every
 * hand-written example passed.
 *
 * So the comparison lives here rather than in a scratch script. Any future
 * change to `translateToRe2` or the split decomposition is checked against
 * `RegExp` across the corpus below, with the known divergences enumerated
 * explicitly — a divergence that is not on that list is a bug.
 */
describe('differential against RegExp', () => {
  /** How a caller compiles: linear engine first, split decomposition second. */
  function compile(pattern: string) {
    return compileLinearRegex(pattern) ?? compileLookaroundSplit(pattern)
  }

  /**
   * Delimiters people actually write, plus the shapes that have broken before.
   * Anything here that the linear engine accepts must split like `RegExp`.
   */
  const SPLIT_PATTERNS = [
    // Plain delimiters
    '\\n\\n',
    '\\n\\n+',
    '\\s+',
    '\\s{2,}',
    '\\.\\s+',
    '[.!?]\\s+',
    '---+',
    '\\|',
    ',\\s*',
    '\\t',
    // Structural
    '\\n#{1,6}\\s',
    '</section>',
    '<br\\s*/?>',
    '\\r?\\n',
    // Lookaround: keep the delimiter
    '(?=#\\s)',
    '(?=#{1,6}\\s)',
    '(?<=\\.)',
    '(?<=</s>)',
    '(?<=\\.)\\s+',
    '(?<=[.!?])\\s+',
    '(?<=[.!?])\\s+(?=[A-Z])',
    '(?<=\\w)\\s+(?=[A-Z])',
    '(?<=\\w)\\s+(?=\\w)',
    '\\n(?=Chapter )',
    '\\n(?=\\d+\\.)',
    '(?<=;)\\s*',
    // Top-level alternation beside an assertion: must be declined, never
    // reshaped — `(?<=X)A|B` is not `(?:X)(A|B)`.
    '(?<=\\.)\\s+|\\n\\n',
    '(?<=</p>)|<hr>',
    'a|b(?=c)',
    '\\n\\n|(?<=\\.)\\s',
    // Quantifier and class shapes
    '[-=]{3,}',
    '\\s*\\n\\s*\\n\\s*',
    '(?:\\r\\n|\\n){2}',
    '[\\s\\u00b7]+',
  ]

  /**
   * Documents chosen to exercise the divergences that have bitten: non-ASCII
   * whitespace from PDF/HTML extraction, CJK, and adjacent delimiters.
   */
  const DOCUMENTS = [
    'Section one\n\nSection two\n\nSection three',
    'One. Two. Three. Four.',
    'A B C D',
    'Heading\n\nAlpha beta.\nGamma delta.',
    '# One\nalpha\n## Two\nbeta\n### Three',
    '<s>one</s><s>two</s><s>three</s>',
    'Chapter 1\nintro\nChapter 2\nmore',
    // Non-breaking and exotic whitespace — the stored-data divergence
    'Section 1. Overview The agreement',
    'Bullet one  Bullet two  Bullet three',
    'Prix : 100 EUR. Livraison offerte.',
    '第一章　概要　第二章　詳細',
    'line separator paragraph',
    'tab\tseparated\tvalues',
    // Degenerate
    '',
    '   ',
    '\n\n\n',
    'nodelimiterhere',
    'a,b,',
    'trailing delimiter.\n\n',
    'Heading\n\nAlpha beta.\nGamma delta.\n\nMore.',
    'one</p>two<hr>three',
    'zabzabz',
  ]

  /**
   * Divergences that are known, documented on the API, and accepted.
   *
   * Keep this list short and specific — it is the honest boundary of the
   * guarantee, so every entry needs a reason, not just a pattern.
   */
  const KNOWN_DIVERGENCES: Array<{ pattern: string; doc: string; reason: string }> = [
    {
      pattern: '(?<=aa)',
      doc: 'aaaaa',
      reason:
        'Lookbehind whose body self-overlaps. Matching every position would mean restarting the scan one character past each match start, which is quadratic on a multi-megabyte document and forfeits the linear guarantee this module exists for. Delimiters that do not self-overlap — punctuation, tags, whitespace — are exact.',
    },
  ]

  function isKnownDivergence(pattern: string): boolean {
    return KNOWN_DIVERGENCES.some((entry) => entry.pattern === pattern)
  }

  /**
   * `LinearRegex.split` omits the trailing empty segment `RegExp` produces, and
   * every caller filters empties anyway — so compare on the filtered forms.
   */
  function normalize(segments: string[]): string[] {
    return segments.filter((segment) => segment !== '')
  }

  describe('differential: split parity with the built-in engine', () => {
    it.each(SPLIT_PATTERNS.filter((pattern) => !isKnownDivergence(pattern)))(
      'splits %s identically to RegExp across every document',
      (pattern) => {
        const compiled = compile(pattern)
        // A pattern the linear engine declines is handled by the caller (notice,
        // literal fallback, or a thrown config error) — not a parity concern.
        if (!compiled) return

        for (const doc of DOCUMENTS) {
          expect(
            normalize(compiled.split(doc)),
            `pattern ${pattern} on ${JSON.stringify(doc)}`
          ).toEqual(normalize(doc.split(new RegExp(pattern, 'g'))))
        }
      }
    )
  })

  describe('differential: lazy split parity with eager split', () => {
    it.each(SPLIT_PATTERNS.filter((pattern) => !isKnownDivergence(pattern)))(
      'iterates %s identically to the eager linear split across every document',
      (pattern) => {
        const compiled = compile(pattern)
        if (!compiled) return

        for (const doc of DOCUMENTS) {
          expect(
            normalize(Array.from(compiled.iterateSplits(doc))),
            `pattern ${pattern} on ${JSON.stringify(doc)}`
          ).toEqual(normalize(compiled.split(doc)))
        }
      }
    )
  })

  describe('differential: test/find parity with the built-in engine', () => {
    /** Grep-style patterns, where `test` and the match index are what matter. */
    const MATCH_PATTERNS = [
      'timeout',
      'ECONNREFUSED',
      'status=\\d+',
      'status=5\\d\\d',
      '^Agent',
      'agent$',
      '(openai|anthropic)',
      '\\bstatus\\b',
      '\\d{4}-\\d{2}-\\d{2}',
      '[Ee]xception',
      'https?://[^\\s"]+',
      '\\$\\{[^}]*\\}',
      'block_\\d+.*output',
      '\\s+$',
      '^\\s*\\{.*\\}\\s*$',
      'a.*b.*c',
      '.*',
      '.+',
      'sk-[A-Za-z0-9]{20,}',
      'rate.?limit',
      '\\w+@\\w+\\.\\w+',
      '[0-9a-f]{8}-[0-9a-f]{4}',
      '\\s',
      '\\S+',
    ]

    const HAYSTACKS = [
      'Agent 1 called api.openai.com -> status=503 at 2026-01-01',
      'request timeout occurred after 30s',
      'ECONNREFUSED connecting to db',
      'user@example.com signed in',
      'sk-abcdefghijklmnopqrstuvwxyz012345',
      'value with non-breaking space',
      '第一章　概要',
      '{ "ok": true }',
      '',
      '   ',
    ]

    it.each(MATCH_PATTERNS)('matches %s identically to RegExp', (pattern) => {
      const compiled = compile(pattern)
      if (!compiled) return

      const oracle = new RegExp(pattern)
      for (const text of HAYSTACKS) {
        const label = `pattern ${pattern} on ${JSON.stringify(text)}`
        expect(compiled.test(text), label).toBe(oracle.test(text))

        const match = oracle.exec(text)
        expect(compiled.find(text), label).toBe(match ? match.index : -1)
      }
    })

    it.each(MATCH_PATTERNS)('matches %s identically to RegExp when ignoring case', (pattern) => {
      const compiled = compileLinearRegex(pattern, { ignoreCase: true })
      if (!compiled) return

      const oracle = new RegExp(pattern, 'i')
      for (const text of HAYSTACKS) {
        expect(compiled.test(text), `pattern ${pattern} on ${JSON.stringify(text)}`).toBe(
          oracle.test(text)
        )
      }
    })
  })

  describe('differential: every known divergence is still exactly as documented', () => {
    // Pinned so the list cannot rot. If a divergence is silently fixed this
    // fails and the entry must be deleted; if one spreads, the parity suites
    // above fail. Either way the list stays honest about the real boundary.
    it.each(KNOWN_DIVERGENCES)('$pattern still diverges on $doc — $reason', ({ pattern, doc }) => {
      const compiled = compile(pattern)
      expect(compiled).not.toBeNull()

      expect(normalize(compiled?.split(doc) ?? [])).not.toEqual(
        normalize(doc.split(new RegExp(pattern, 'g')))
      )
    })
  })
})
