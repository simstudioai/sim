/**
 * Guards for the `currency` column's display helpers: a rendered amount reads back as the same
 * number, and a cell with no readable amount is never blanked.
 */
import { parseCurrencyInput } from '@sim/table-cells/currency'
import { describe, expect, it } from 'vitest'
import { formatCurrencyDisplay, formatCurrencyForInput } from '@/lib/table/currency-format'

describe('formatCurrencyDisplay', () => {
  it('round-trips through parseCurrencyInput', () => {
    for (const amount of [0, 12, -12.5, 1234.56, 1234567.89]) {
      const rendered = formatCurrencyDisplay(amount, 'USD', 'en-US')
      expect(parseCurrencyInput(rendered)).toBe(amount)
    }
  })

  it('renders an unreadable value verbatim rather than blanking it', () => {
    // What a string → currency conversion can leave behind.
    expect(formatCurrencyDisplay('pending', 'USD', 'en-US')).toBe('pending')
    expect(formatCurrencyDisplay(null, 'USD', 'en-US')).toBe('')
  })
})

describe('formatCurrencyForInput', () => {
  it('keeps unparseable text so an edit does not silently erase it', () => {
    expect(formatCurrencyForInput('pending')).toBe('pending')
  })
})
