import { describe, expect, it } from 'vitest'
import { analyzeFileSearchRegex, FileSearchPatternError } from '@/lib/workspace-files/search/regex'

const run = (source: string) => analyzeFileSearchRegex(source).longestLiteralRun

describe('analyzeFileSearchRegex', () => {
  describe('guaranteed literal runs', () => {
    it('counts a plain literal and joins runs across a group', () => {
      expect(run('needle')).toBe(6)
      expect(run('nee(?:d)le')).toBe(6)
      expect(run('^needle$')).toBe(6)
      expect(run('\\bneedle\\b')).toBe(6)
    })

    it('takes the weaker branch of an alternation', () => {
      expect(run('foo|bar')).toBe(3)
      expect(run('foo|ab')).toBe(2)
      expect(run('(?:foo|ab)baz')).toBe(3)
    })

    it('breaks a run at anything that is not one fixed character', () => {
      expect(run('a.c')).toBe(1)
      expect(run('ab[0-9]cd')).toBe(2)
      expect(run('ab\\dcd')).toBe(2)
    })

    it('drops an optional atom from the guarantee and keeps a required one', () => {
      expect(run('abc?d')).toBe(2)
      expect(run('abc*d')).toBe(2)
      expect(run('(?:xyz)?ab')).toBe(2)
      expect(run('foo+bar')).toBe(4)
      expect(run('ab{3}cd')).toBe(6)
      expect(run('ab{2,4}cd')).toBe(3)
    })

    it('measures a run in characters, not UTF-16 units', () => {
      expect(run('🙂🙂needle')).toBe(8)
      expect(run('🙂🙂')).toBe(2)
      expect(run('東京都')).toBe(3)
    })

    it('does not let a bounded repeat expand into a large intermediate', () => {
      expect(run('(?:(?:abc){1000}){1000}')).toBeGreaterThanOrEqual(3)
      expect(run('(?:(?:abc){1000}){1000}')).toBeLessThanOrEqual(512)
    })
  })

  describe('PostgreSQL spelling', () => {
    it('rewrites word boundaries and leaves everything else untouched', () => {
      expect(analyzeFileSearchRegex('\\bTODO\\b').postgresSource).toBe('\\yTODO\\y')
      expect(analyzeFileSearchRegex('TODO\\(\\w+\\)').postgresSource).toBe('TODO\\(\\w+\\)')
    })

    it('reports whether the pattern anchors', () => {
      expect(analyzeFileSearchRegex('^import ').anchored).toBe(true)
      expect(analyzeFileSearchRegex('import ;$').anchored).toBe(true)
      expect(analyzeFileSearchRegex('import \\$foo').anchored).toBe(false)
      expect(analyzeFileSearchRegex('import [$]foo').anchored).toBe(false)
    })

    it('collects literals without the metacharacters that spell them', () => {
      expect(analyzeFileSearchRegex('\\werror\\D+').literals).toBe('error')
    })
  })

  describe('rejections', () => {
    it.each([
      ['foo(?=bar)', /Lookahead/],
      ['foo(?!bar)', /Lookahead/],
      ['(?<=foo)bar', /Lookbehind/],
      ['(?<!foo)bar', /Lookbehind/],
      ['(?<name>foo)', /Named group/],
      ['(?i)foo', /Inline flag/],
      ['(foo)\\1bar', /Backreference/],
      ['[[:alpha:]]foo', /POSIX class/],
      ['\\p{Lu}foo', /Unicode property/],
      ['\\yfoo\\y', /"\\y" is not supported — write "\\b" instead/],
      ['foo\\qbar', /not a supported escape/],
      ['foo[\\b]bar', /inside "\[\.\.\.\]"/],
      ['foo(bar', /Unclosed "\("/],
      ['foo)bar', /Unbalanced "\)"/],
      ['foo[bar', /Unclosed "\["/],
      ['foo\\', /trailing backslash/],
      ['*foo', /has no character to repeat/],
      ['foo{2,1}', /counts down/],
      ['a{1,5000}bcd', /exceeds 1000/],
      ['a{5000,}bcd', /exceeds 1000/],
      ['foo{bar}', /Unescaped "\{"/],
    ])('rejects %s', (source, message) => {
      expect(() => analyzeFileSearchRegex(source)).toThrow(FileSearchPatternError)
      expect(() => analyzeFileSearchRegex(source)).toThrow(message)
    })

    it('rejects a group nested past the depth limit', () => {
      const deep = `${'('.repeat(21)}needle${')'.repeat(21)}`
      expect(() => analyzeFileSearchRegex(deep)).toThrow(/nests groups more than 20 deep/)
    })
  })

  describe('accepted subset', () => {
    it.each([
      'error \\d+',
      'TODO\\(.*\\)',
      '^import .*from',
      '\\bfixme\\b',
      'level=(?:warn|error)',
      'status: [0-9]{3} failed',
      'cache.*?miss',
      'user_id=\\w+ token',
      'error a{3,}bcd',
      'error a{3,10}bcd',
    ])('accepts %s', (source) => {
      expect(() => analyzeFileSearchRegex(source)).not.toThrow()
    })

    it('accepts every pattern it admits as a JavaScript RegExp too', () => {
      const accepted = [
        'error \\d+',
        'TODO\\(.*\\)',
        '^import .*from',
        '\\bfixme\\b',
        'level=(?:warn|error)',
        'status: [0-9]{3} failed',
        'cache.*?miss',
        'a\\-b\\.c[^\\]]xyz',
      ]
      for (const source of accepted) {
        expect(() => new RegExp(source)).not.toThrow()
      }
    })
  })
})
