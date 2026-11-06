import { describe, expect, it } from 'vitest'
import {
  formatCsvValue,
  neutralizeCsvFormula,
  toCsvLinePieces,
  toCsvRow,
} from '@/lib/core/utils/csv'

describe('CSV formatting', () => {
  it.each(['=1+1', '+1+1', '-1+1', '@SUM(A1)', '\t=1+1', '\r=1+1'])(
    'neutralizes formula-leading text: %j',
    (value) => {
      expect(neutralizeCsvFormula(value)).toBe(`'${value}`)
      expect(formatCsvValue(value)).toBe(`'${value}`)
    }
  )

  it('handles objects that serialize to undefined', () => {
    expect(formatCsvValue({ toJSON: () => undefined })).toBe('')
  })

  it('escapes quotes, commas, and record separators', () => {
    expect(toCsvRow(['plain', 'with,comma', 'with"quote', 'with\nnewline', 'with\rreturn'])).toBe(
      'plain,"with,comma","with""quote","with\nnewline","with\rreturn"'
    )
  })

  it.each([1, 2, 3, 7, 0, -5, 1.5, Number.NaN])(
    'splits a line into pieces that encode to the same bytes as the whole line (piece size %s)',
    (maxPieceChars) => {
      const values = [
        'plain',
        'a"b,c',
        '\u{1F600}"x\u{1F600}\n\u{1F600}',
        '',
        '\uD83D\u{1F600}',
        '\uDE00\u{1F600}\uDE00',
        'lone\uD83D',
        'tail\u{1F600}',
      ]
      const pieces = [...toCsvLinePieces(values, maxPieceChars)]
      const encoder = new TextEncoder()
      const pieceBytes = Buffer.concat(pieces.map((piece) => encoder.encode(piece)))

      expect(pieces.join('')).toBe(`${toCsvRow(values)}\n`)
      expect(pieceBytes.equals(encoder.encode(`${toCsvRow(values)}\n`))).toBe(true)
    }
  )
})
