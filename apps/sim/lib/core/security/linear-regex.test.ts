/**
 * @vitest-environment node
 */

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

  it('interprets regex syntax rather than matching it literally', () => {
    const regex = compileLinearRegex('status=\\d+')
    expect(regex?.test('http status=503 here')).toBe(true)
    expect(regex?.test('status=abc')).toBe(false)
    expect(regex?.find('http status=503')).toBe(5)
  })

  it('honours ignoreCase only when asked', () => {
    expect(compileLinearRegex('ERROR', { ignoreCase: true })?.test('an error here')).toBe(true)
    expect(compileLinearRegex('ERROR')?.test('an error here')).toBe(false)
  })

  it('splits equivalently to String.prototype.split, minus the trailing empty', () => {
    const doc = '# One\ntext a\n\n# Two\ntext b'
    expect(compileLinearRegex('\\n\\n+')?.split(doc)).toEqual(doc.split(/\n\n+/g))

    // The documented divergence: a trailing delimiter yields no empty tail.
    expect(compileLinearRegex(',')?.split('a,b,')).toEqual(['a', 'b'])
    expect('a,b,'.split(/,/g)).toEqual(['a', 'b', ''])
  })

  it.each([
    ['non-breaking space', '\u00a0'],
    ['narrow no-break space', '\u202f'],
    ['ideographic space', '\u3000'],
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

  it('returns -1 from find when there is no match', () => {
    expect(compileLinearRegex('zzz')?.find('abc')).toBe(-1)
  })
})

describe('literalRegex', () => {
  it('treats regex syntax as ordinary characters', () => {
    const regex = literalRegex('a+b')
    expect(regex.test('xxa+bxx')).toBe(true)
    expect(regex.test('aaab')).toBe(false)
  })

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
  it('splits before each delimiter for (?=X), matching String.split', () => {
    const doc = '# One\nalpha\n# Two\nbeta'
    expect(compileLookaroundSplit('(?=#\\s)')?.split(doc)).toEqual(
      doc.split(/(?=#\s)/g).filter(Boolean)
    )
  })

  it('splits after each delimiter for (?<=X)', () => {
    const doc = '<s>one</s><s>two</s><s>three</s>'
    expect(compileLookaroundSplit('(?<=</s>)')?.split(doc)).toEqual([
      '<s>one</s>',
      '<s>two</s>',
      '<s>three</s>',
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
    ['split after a period', '(?<=\\.)\\s+', 'One. Two. Three.'],
    ['split before a heading', '\\n(?=Chapter )', 'intro\nChapter 1\nChapter 2'],
    ['sentence splitter', '(?<=[.!?])\\s+(?=[A-Z])', 'One. Two! Three? four.'],
  ])('handles %s, where the assertion has an affix', (_label, pattern, doc) => {
    // These are the common shapes: a lookaround combined with other syntax.
    // Handling only a whole-pattern assertion would reject them outright.
    const split = compileLookaroundSplit(pattern)?.split(doc)
    expect(split).toEqual(doc.split(new RegExp(pattern, 'g')))
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

  it.each([
    ['(?<=\\w)\\s+(?=[A-Z])', 'A B C D'],
    ['(?<=\\w)\\s+(?=\\w)', 'a b c d e'],
  ])('does not consume assertion text between boundaries (%s)', (pattern, doc) => {
    // The lookahead of one boundary is the lookbehind of the next. Consuming
    // it would swallow every other split.
    expect(compileLookaroundSplit(pattern)?.split(doc)).toEqual(doc.split(new RegExp(pattern, 'g')))
  })
})
