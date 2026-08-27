import { describe, expect, it } from 'vitest'
import { exceedsTablePasteRowLimit, parseBoundedTsv } from './table-paste'

describe('parseBoundedTsv', () => {
  it('parses LF and CRLF rows and drops one trailing empty row', () => {
    expect(parseBoundedTsv('a\tb\r\nc\td\n', 2)).toEqual({
      rows: [
        ['a', 'b'],
        ['c', 'd'],
      ],
      maxColumns: 2,
    })
  })

  it('does not retain cells beyond the available grid columns', () => {
    expect(parseBoundedTsv('a\tb\tc\td', 2)).toEqual({
      rows: [['a', 'b']],
      maxColumns: 2,
    })
  })

  it('preserves an intentional empty final cell', () => {
    expect(parseBoundedTsv('a\t', 2)).toEqual({ rows: [['a', '']], maxColumns: 2 })
  })

  it('preserves interior blank rows and classic Mac row separators', () => {
    expect(parseBoundedTsv('a\r\rb', 2)).toEqual({
      rows: [['a'], [''], ['b']],
      maxColumns: 1,
    })
  })
})

describe('exceedsTablePasteRowLimit', () => {
  it('does not count a trailing row separator as an extra row', () => {
    expect(exceedsTablePasteRowLimit('a\nb\n', 2)).toBe(false)
    expect(exceedsTablePasteRowLimit('a\nb\nc', 2)).toBe(true)
  })
})
