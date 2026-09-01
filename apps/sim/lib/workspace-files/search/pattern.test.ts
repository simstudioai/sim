import { describe, expect, it } from 'vitest'
import {
  compileFileSearchPattern,
  escapeFileSearchLikePattern,
  FileSearchPatternError,
  isFileSearchCaseSensitive,
} from '@/lib/workspace-files/search/pattern'

describe('compileFileSearchPattern', () => {
  describe('shared query rules', () => {
    it.each(['exact', 'regex'] as const)('bounds and screens the query in %s mode', (mode) => {
      expect(() => compileFileSearchPattern('ab', mode)).toThrow(/at least 3 characters/)
      expect(() => compileFileSearchPattern('a'.repeat(513), mode)).toThrow(/at most 512/)
      expect(() => compileFileSearchPattern('abc\0def', mode)).toThrow(/NUL/)
    })
  })

  describe('exact mode', () => {
    it('implements Unicode smart-case and escapes LIKE metacharacters', () => {
      expect(isFileSearchCaseSensitive('résumé')).toBe(false)
      expect(isFileSearchCaseSensitive('Résumé')).toBe(true)
      expect(isFileSearchCaseSensitive('東京A')).toBe(true)
      expect(escapeFileSearchLikePattern('100%_done\\')).toBe('100\\%\\_done\\\\')
    })

    it('wraps the escaped query for LIKE and keeps the raw text for ranking', () => {
      const pattern = compileFileSearchPattern('100%_done', 'exact')

      expect(pattern).toMatchObject({
        mode: 'exact',
        caseSensitive: false,
        sqlPattern: '%100\\%\\_done%',
        literalText: '100%_done',
        wholeLineOnly: false,
      })
    })

    it('reads regex metacharacters as text', () => {
      const pattern = compileFileSearchPattern('a.c', 'exact')

      expect(pattern.sqlPattern).toBe('%a.c%')
      expect(pattern.findMatchRange('xxabcxx')).toEqual({ start: 0, end: 3 })
    })
  })

  describe('regex mode', () => {
    it('matches through PostgreSQL spelling while ranking has no fixed literal', () => {
      const pattern = compileFileSearchPattern('\\bTODO\\b', 'regex')

      expect(pattern).toMatchObject({
        mode: 'regex',
        sqlPattern: '\\yTODO\\y',
        literalText: null,
        caseSensitive: true,
      })
    })

    it('derives smart case from literals, not from metacharacters', () => {
      expect(compileFileSearchPattern('error \\d+', 'regex').caseSensitive).toBe(false)
      expect(compileFileSearchPattern('error \\D+', 'regex').caseSensitive).toBe(false)
      expect(compileFileSearchPattern('[A-Z]+ error', 'regex').caseSensitive).toBe(false)
      expect(compileFileSearchPattern('Error \\d+', 'regex').caseSensitive).toBe(true)
    })

    it('restricts an anchored pattern to segments that hold a whole line', () => {
      expect(compileFileSearchPattern('^import x', 'regex').wholeLineOnly).toBe(true)
      expect(compileFileSearchPattern('import x;$', 'regex').wholeLineOnly).toBe(true)
      expect(compileFileSearchPattern('import x', 'regex').wholeLineOnly).toBe(false)
    })

    it('requires a literal run long enough for the trigram index to be used', () => {
      expect(() => compileFileSearchPattern('\\w+ \\d+', 'regex')).toThrow(FileSearchPatternError)
      expect(() => compileFileSearchPattern('\\w+ \\d+', 'regex')).toThrow(
        /at least 3 consecutive literal characters/
      )
      expect(() => compileFileSearchPattern('\\d{4}-\\d{2}-\\d{2}', 'regex')).toThrow(
        /at least 3 consecutive literal characters/
      )
      expect(() => compileFileSearchPattern('error \\d+', 'regex')).not.toThrow()
    })

    it('locates the match so a long line previews around it', () => {
      const pattern = compileFileSearchPattern('needle\\d+', 'regex')

      expect(pattern.findMatchRange('xxx needle42 yyy')).toEqual({ start: 4, end: 12 })
      expect(pattern.findMatchRange('no match here')).toBeNull()
    })

    it('never returns a range that splits a surrogate pair', () => {
      const pattern = compileFileSearchPattern('.needle', 'regex')
      const line = `a🙂needle`
      const range = pattern.findMatchRange(line)

      expect(range).not.toBeNull()
      expect([...line.slice(range?.start, range?.end)].join('')).not.toContain('�')
      expect(line.slice(range?.start, range?.end)).toBe('🙂needle')
    })

    it('does not carry match state between calls', () => {
      const pattern = compileFileSearchPattern('needle', 'regex')

      expect(pattern.findMatchRange('a needle')).toEqual({ start: 2, end: 8 })
      expect(pattern.findMatchRange('a needle')).toEqual({ start: 2, end: 8 })
    })
  })
})
