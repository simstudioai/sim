/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  applyLineInsertion,
  applyStringReplacement,
  countLines,
  EditContentError,
} from '@/lib/workspace-files/edit-content'

const NOTE = ['# Commitments', '', '- ship the thing', '- review the doc', ''].join('\n')

describe('applyStringReplacement', () => {
  it('replaces the single occurrence', () => {
    expect(applyStringReplacement(NOTE, '- ship the thing', '- shipped the thing')).toBe(
      ['# Commitments', '', '- shipped the thing', '- review the doc', ''].join('\n')
    )
  })

  it('deletes when the replacement is empty', () => {
    expect(applyStringReplacement('a\nb\nc', 'b\n', '')).toBe('a\nc')
  })

  it('refuses text that does not appear', () => {
    expect(() => applyStringReplacement(NOTE, 'nope', 'x')).toThrow(/does not appear in this file/)
  })

  it('refuses empty search text rather than matching everywhere', () => {
    expect(() => applyStringReplacement(NOTE, '', 'x')).toThrow(/cannot be empty/)
  })

  /*
   * The whole point of the operation. Taking the first match would rewrite an
   * arbitrary line; the caller is told where each one is so it can disambiguate.
   */
  it('refuses an ambiguous match and names every line it sits on', () => {
    const text = ['- todo', 'middle', '- todo', 'tail', '- todo'].join('\n')

    try {
      applyStringReplacement(text, '- todo', '- done')
      throw new Error('expected a refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(EditContentError)
      const failure = (error as EditContentError).failure
      expect(failure).toEqual({ reason: 'ambiguous', lineNumbers: [1, 3, 5] })
      expect((error as EditContentError).message).toContain('lines 1, 3, 5')
    }
  })

  it('counts a multi-line match on the line it starts at', () => {
    const text = ['x', 'a\nb', 'y', 'a\nb'].join('\n')

    try {
      applyStringReplacement(text, 'a\nb', 'z')
      throw new Error('expected a refusal')
    } catch (error) {
      expect((error as EditContentError).failure).toEqual({
        reason: 'ambiguous',
        lineNumbers: [2, 5],
      })
    }
  })

  /** Overlapping text must not be double-counted into a false ambiguity. */
  it('does not count overlapping matches twice', () => {
    expect(applyStringReplacement('aaa', 'aa', 'b')).toBe('ba')
  })
})

describe('applyLineInsertion', () => {
  it('inserts after the given line', () => {
    expect(applyLineInsertion(NOTE, 3, '- call Dana')).toBe(
      ['# Commitments', '', '- ship the thing', '- call Dana', '- review the doc', ''].join('\n')
    )
  })

  it('prepends at line 0', () => {
    expect(applyLineInsertion('a\nb', 0, 'top')).toBe('top\na\nb')
  })

  it('appends at the last line', () => {
    expect(applyLineInsertion('a\nb', 2, 'tail')).toBe('a\nb\ntail')
  })

  it('inserts several lines at once', () => {
    expect(applyLineInsertion('a\nb', 1, 'x\ny')).toBe('a\nx\ny\nb')
  })

  /** Clamping would silently write to the wrong end of the file. */
  it('refuses a line past the end instead of clamping', () => {
    try {
      applyLineInsertion('a\nb', 9, 'x')
      throw new Error('expected a refusal')
    } catch (error) {
      expect(error).toBeInstanceOf(EditContentError)
      expect((error as EditContentError).failure).toEqual({
        reason: 'line_out_of_range',
        lineCount: 2,
      })
      expect((error as EditContentError).message).toContain('has 2 lines')
    }
  })

  it('refuses a negative or fractional line', () => {
    expect(() => applyLineInsertion('a\nb', -1, 'x')).toThrow(/whole number/)
    expect(() => applyLineInsertion('a\nb', 1.5, 'x')).toThrow(/whole number/)
  })

  it('keeps a trailing newline trailing', () => {
    expect(applyLineInsertion('a\nb\n', 2, 'c')).toBe('a\nb\nc\n')
  })

  /** A note written on Windows must not come back with one stray LF in it. */
  it('matches the line ending the file already uses', () => {
    expect(applyLineInsertion('a\r\nb\r\n', 1, 'x')).toBe('a\r\nx\r\nb\r\n')
  })

  it('counts lines the way a reader does, ignoring the trailing newline', () => {
    expect(() => applyLineInsertion('a\nb\n', 3, 'x')).toThrow(/has 2 lines/)
  })
})

/*
 * Every surface that reports or accepts a line number counts through here, so
 * `insert` accepts exactly the range that a ranged read and an edit report.
 * Counting the trailing newline as a line told an agent the file was one line
 * longer than `insert` would take.
 */
describe('countLines', () => {
  it('does not count the trailing newline as a line', () => {
    expect(countLines('a\nb\n')).toBe(2)
  })

  it('counts a file with no trailing newline', () => {
    expect(countLines('a\nb')).toBe(2)
  })

  it('counts an empty file as one line', () => {
    expect(countLines('')).toBe(1)
  })

  it('counts blank lines in the middle', () => {
    expect(countLines('a\n\nb\n')).toBe(3)
  })

  it('agrees with the largest line insert will accept', () => {
    const text = 'a\nb\nc\n'

    expect(() => applyLineInsertion(text, countLines(text), 'x')).not.toThrow()
    expect(() => applyLineInsertion(text, countLines(text) + 1, 'x')).toThrow()
  })
})
