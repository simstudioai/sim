import { describe, expect, it } from 'vitest'
import { formatCsvValue, neutralizeCsvFormula, toCsvRow } from '@/lib/core/utils/csv'

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
})
