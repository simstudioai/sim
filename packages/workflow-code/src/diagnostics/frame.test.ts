import { describe, expect, it } from 'vitest'
import { codeFrame } from './frame'

const SEVEN_LINES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'].join('\n')

describe('codeFrame', () => {
  it('shows two lines of context on each side with a caret under the span', () => {
    expect(codeFrame(SEVEN_LINES, { line: 4, column: 2, endLine: 4, endColumn: 4 })).toBe(
      ['  2 | two', '  3 | three', '> 4 | four', '    |  ^^', '  5 | five', '  6 | six'].join('\n')
    )
  })

  it('clips context at the start and end of the text', () => {
    expect(codeFrame(SEVEN_LINES, { line: 1, column: 1 })).toBe(
      ['> 1 | one', '    | ^', '  2 | two', '  3 | three'].join('\n')
    )
    expect(codeFrame(SEVEN_LINES, { line: 7, column: 6 })).toBe(
      ['  5 | five', '  6 | six', '> 7 | seven', '    |      ^'].join('\n')
    )
  })

  it('counts CRLF, CR, U+2028 and U+2029 as line breaks the way Babel does', () => {
    const text = 'a\r\nb\rc\u2028d\u2029e'
    expect(codeFrame(text, { line: 5, column: 1 })).toBe(
      ['  3 | c', '  4 | d', '> 5 | e', '    | ^'].join('\n')
    )
  })

  it('keeps tabs in the caret padding so the caret lines up under tabbed source', () => {
    expect(codeFrame('\tx = 1', { line: 1, column: 2, endLine: 1, endColumn: 3 })).toBe(
      ['> 1 | \tx = 1', '    | \t^'].join('\n')
    )
  })

  it('measures columns in UTF-16 code units', () => {
    expect(codeFrame("'😀' + a", { line: 1, column: 8, endLine: 1, endColumn: 9 })).toBe(
      ["> 1 | '😀' + a", '    |        ^'].join('\n')
    )
  })

  it('draws one caret for an empty span and runs a multi-line span to the end of its first line', () => {
    expect(codeFrame('abc', { line: 1, column: 2, endLine: 1, endColumn: 2 })).toBe(
      ['> 1 | abc', '    |  ^'].join('\n')
    )
    expect(codeFrame('abc\ndef', { line: 1, column: 2, endLine: 2, endColumn: 2 })).toBe(
      ['> 1 | abc', '    |  ^^', '> 2 | def'].join('\n')
    )
  })

  it('widens the gutter when context crosses into more digits', () => {
    const text = Array.from({ length: 11 }, (_, i) => `l${i + 1}`).join('\n')
    expect(codeFrame(text, { line: 9, column: 1, endLine: 9, endColumn: 3 })).toBe(
      ['   7 | l7', '   8 | l8', '>  9 | l9', '     | ^^', '  10 | l10', '  11 | l11'].join('\n')
    )
  })

  it('clamps a location outside the text instead of throwing', () => {
    expect(codeFrame('ab', { line: 9, column: 40 })).toBe(['> 1 | ab', '    |   ^'].join('\n'))
    expect(codeFrame('', { line: 0, column: 0 })).toBe(['> 1 |', '    | ^'].join('\n'))
  })

  it('treats NaN as the first line or column and Infinity as the last, instead of throwing', () => {
    expect(codeFrame('ab\ncd', { line: Number.NaN, column: Number.NaN })).toBe(
      ['> 1 | ab', '    | ^', '  2 | cd'].join('\n')
    )
    expect(
      codeFrame('ab\ncd', {
        line: Number.POSITIVE_INFINITY,
        column: Number.POSITIVE_INFINITY,
        endColumn: Number.NaN,
      })
    ).toBe(['  1 | ab', '> 2 | cd', '    |   ^'].join('\n'))
    expect(
      codeFrame('ab', { line: 1, column: 1, endLine: Number.NaN, endColumn: Number.NaN })
    ).toBe(['> 1 | ab', '    | ^'].join('\n'))
  })

  it('never emits ANSI escapes or trailing spaces on empty lines', () => {
    const frame = codeFrame('a\n\nb', { line: 3, column: 1 })
    expect(frame).toBe(['  1 | a', '  2 |', '> 3 | b', '    | ^'].join('\n'))
    expect(frame).not.toContain('\u001b')
  })

  it('shows a window of a long line around the column, so frame size does not grow with the line', () => {
    const long = `${'a'.repeat(100_000)}X${'b'.repeat(100_000)}`
    const frame = codeFrame(`ctx\n${long}\nctx`, { line: 2, column: 100_001, endColumn: 100_002 })
    const [before, focal, caret, after] = frame.split('\n')
    expect(before).toBe('  1 | …')
    expect(after).toBe('  3 | …')
    expect(focal).toBe(`> 2 | …${'a'.repeat(60)}X${'b'.repeat(99)}…`)
    expect(caret.indexOf('^') - '    | '.length).toBe(focal.indexOf('X') - '> 2 | '.length)
  })

  it('keeps the window at the end of a long line and caps carets at the window', () => {
    const long = 'a'.repeat(1_000)
    const frame = codeFrame(long, { line: 1, column: 991, endColumn: 2_000 })
    const [focal, caret] = frame.split('\n')
    expect(focal).toBe(`> 1 | …${'a'.repeat(160)}`)
    expect(caret).toBe(`    | ${' '.repeat(151)}${'^'.repeat(10)}`)
  })

  it('clips a long context line under a short framed line', () => {
    expect(codeFrame(`ab\n${'c'.repeat(500)}`, { line: 1, column: 1 })).toBe(
      ['> 1 | ab', '    | ^', `  2 | ${'c'.repeat(160)}…`].join('\n')
    )
  })
})
