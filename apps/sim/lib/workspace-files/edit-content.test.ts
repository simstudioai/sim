/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  applyStringReplacement,
  applyWorkspaceFileContentEdit,
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

  it('does not count overlapping matches twice', () => {
    expect(applyStringReplacement('aaa', 'aa', 'b')).toBe('ba')
  })

  it('replaces every non-overlapping match when explicitly requested', () => {
    expect(applyStringReplacement('a a a', 'a', 'b', true)).toBe('b b b')
  })
})

describe('applyWorkspaceFileContentEdit', () => {
  it('replaces only the content between anchors', () => {
    expect(
      applyWorkspaceFileContentEdit('before\nold\nafter\n', {
        mode: 'replace_between',
        beforeAnchor: 'before',
        afterAnchor: 'after',
        content: 'new\nlines',
      })
    ).toBe('before\nnew\nlines\nafter\n')
  })

  it('inserts after a complete trimmed anchor line', () => {
    expect(
      applyWorkspaceFileContentEdit('heading\r\n  anchor  \r\ntail\r\n', {
        mode: 'insert_after',
        anchor: 'anchor',
        content: 'one\ntwo',
      })
    ).toBe('heading\r\n  anchor  \r\none\r\ntwo\r\ntail\r\n')
  })

  it('deletes the start anchor and interior while preserving the end anchor', () => {
    expect(
      applyWorkspaceFileContentEdit('before\nstart\nremove\nend\nafter', {
        mode: 'delete_between',
        startAnchor: 'start',
        endAnchor: 'end',
      })
    ).toBe('before\nend\nafter')
  })

  it('uses the requested occurrence for repeated anchors', () => {
    expect(
      applyWorkspaceFileContentEdit('anchor\none\nanchor\ntwo\nanchor', {
        mode: 'insert_after',
        anchor: 'anchor',
        occurrence: 2,
        content: 'inserted',
      })
    ).toBe('anchor\none\nanchor\ninserted\ntwo\nanchor')
  })

  it('refuses missing anchors and invalid occurrences', () => {
    expect(() =>
      applyWorkspaceFileContentEdit('a\nb', {
        mode: 'insert_after',
        anchor: 'missing',
        content: 'x',
      })
    ).toThrow(/Anchor line not found/)
    expect(() =>
      applyWorkspaceFileContentEdit('a\nb', {
        mode: 'insert_after',
        anchor: 'a',
        occurrence: 0,
        content: 'x',
      })
    ).toThrow(/whole number/)
  })

  it('supports exact replacement through the shared protocol', () => {
    expect(
      applyWorkspaceFileContentEdit('a a', {
        mode: 'search_replace',
        search: 'a',
        content: 'b',
        replaceAll: true,
      })
    ).toBe('b b')
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
})

/*
 * A short search string in a large file can match thousands of times. Naming
 * every line built an error larger than the file, and computing each line by
 * rescanning from the start was quadratic.
 */
describe('a heavily ambiguous match', () => {
  const many = Array.from({ length: 5000 }, (_, i) => `- item ${i}`).join('\n')

  it('caps the lines it names and says how many more there are', () => {
    try {
      applyStringReplacement(many, '- item', 'x')
      throw new Error('expected a refusal')
    } catch (error) {
      const message = (error as EditContentError).message
      expect(message).toContain('appears 5000 times')
      expect(message).toContain('and 4990 more')
      expect((error as EditContentError).failure).toMatchObject({ reason: 'ambiguous' })
      expect(
        ((error as EditContentError).failure as { lineNumbers: number[] }).lineNumbers
      ).toHaveLength(10)
    }
  })

  it('stays linear rather than rescanning per match', () => {
    const started = performance.now()
    expect(() => applyStringReplacement(many, '- item', 'x')).toThrow()
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
