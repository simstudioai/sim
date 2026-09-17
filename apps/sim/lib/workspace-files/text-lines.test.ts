import { describe, expect, it } from 'vitest'
import { sliceFileTextLines } from '@/lib/workspace-files/text-lines'

describe('file text line windows', () => {
  it.each(['', '\n', '\n\n', 'one', 'one\n', 'one\r\ntwo\n\nthree\r\n', 'one\rtwo'])(
    'preserves visible-line semantics for %j',
    (text) => {
      const split = text.split(/\r\n|\n/)
      const lines = split.length > 1 && split.at(-1) === '' ? split.slice(0, -1) : split
      for (const offset of [1, 2, 4, 20])
        for (const limit of [undefined, 0, 1, 3]) {
          const window = lines.slice(
            offset - 1,
            limit === undefined ? undefined : offset - 1 + limit
          )
          expect(sliceFileTextLines(text, offset, limit, false)).toEqual({
            text: window.join(text.includes('\r\n') ? '\r\n' : '\n'),
            lineRange: {
              offset,
              lineCount: window.length,
              totalLines: lines.length,
              totalLinesExact: true,
            },
          })
        }
    }
  )
  it('reads a late window in a newline-dense document', () => {
    const result = sliceFileTextLines(
      `${'abc\n'.repeat(1_000_000)}tail needle\n`,
      1_000_001,
      1,
      false
    )
    expect(result).toEqual({
      text: 'tail needle',
      lineRange: { offset: 1_000_001, lineCount: 1, totalLines: 1_000_001, totalLinesExact: true },
    })
  })
  it('keeps unwindowed text and reports incomplete extraction honestly', () => {
    expect(sliceFileTextLines('a\r\n', undefined, undefined, false)).toEqual({ text: 'a\r\n' })
    expect(sliceFileTextLines('a\n', 1, 1, true).lineRange?.totalLinesExact).toBe(false)
  })
})
