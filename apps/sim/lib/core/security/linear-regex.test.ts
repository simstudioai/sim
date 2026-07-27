/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  compileLinearRegex,
  escapeRegExp,
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

  it('splits equivalently to String.prototype.split', () => {
    const doc = '# One\ntext a\n\n# Two\ntext b'
    expect(compileLinearRegex('\\n\\n+')?.split(doc)).toEqual(doc.split(/\n\n+/g))
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

  it('escapes every metacharacter so the pattern matches only itself', () => {
    const raw = 'a.*+?^${}()|[]\\b'
    expect(new RegExp(escapeRegExp(raw)).test(raw)).toBe(true)
  })
})
