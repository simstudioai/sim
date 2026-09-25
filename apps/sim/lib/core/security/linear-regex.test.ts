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
