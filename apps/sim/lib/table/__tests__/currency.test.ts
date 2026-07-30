/**
 * @vitest-environment node
 *
 * Guards for the `currency` column type. The parser is the load-bearing piece:
 * filters and sorts cast a currency cell to `numeric`, so anything it lets
 * through unparsed would break every query against the column.
 */
import { describe, expect, it } from 'vitest'
import {
  CURRENCY_OPTIONS,
  DEFAULT_CURRENCY_CODE,
  formatCurrencyDisplay,
  formatCurrencyForInput,
  isSupportedCurrencyCode,
  parseCurrencyInput,
  resolveCurrencyCode,
} from '@/lib/table/currency'

describe('parseCurrencyInput', () => {
  it('passes finite numbers through and rejects non-finite ones', () => {
    expect(parseCurrencyInput(1234.56)).toBe(1234.56)
    expect(parseCurrencyInput(0)).toBe(0)
    expect(parseCurrencyInput(-5)).toBe(-5)
    expect(parseCurrencyInput(Number.NaN)).toBeNull()
    expect(parseCurrencyInput(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('strips symbols, ISO codes, and every flavor of space', () => {
    expect(parseCurrencyInput('$1234.56')).toBe(1234.56)
    expect(parseCurrencyInput('€ 12')).toBe(12)
    expect(parseCurrencyInput('USD 12.50')).toBe(12.5)
    expect(parseCurrencyInput('12,50 €')).toBe(12.5)
    // Non-breaking and narrow-no-break spaces are what fr/ru locales group with.
    expect(parseCurrencyInput('1 234,56 €')).toBe(1234.56)
    expect(parseCurrencyInput('1 234.56')).toBe(1234.56)
  })

  it('reads accounting negatives', () => {
    expect(parseCurrencyInput('(1,234.56)')).toBe(-1234.56)
    expect(parseCurrencyInput('($12)')).toBe(-12)
    expect(parseCurrencyInput('-$12.50')).toBe(-12.5)
  })

  it('treats the later separator as the decimal point when both appear', () => {
    expect(parseCurrencyInput('1,234.56')).toBe(1234.56)
    expect(parseCurrencyInput('1.234,56')).toBe(1234.56)
    expect(parseCurrencyInput('1,234,567.89')).toBe(1234567.89)
    expect(parseCurrencyInput('1.234.567,89')).toBe(1234567.89)
  })

  it('disambiguates a lone comma by the digits that follow it', () => {
    // Exactly three trailing digits reads as grouping...
    expect(parseCurrencyInput('1,500')).toBe(1500)
    expect(parseCurrencyInput('100,000')).toBe(100000)
    // ...anything else is a decimal comma.
    expect(parseCurrencyInput('1,5')).toBe(1.5)
    expect(parseCurrencyInput('0,25')).toBe(0.25)
    expect(parseCurrencyInput('12,3456')).toBe(12.3456)
  })

  it('treats repeated dots as grouping and a lone dot as the decimal point', () => {
    expect(parseCurrencyInput('1.234.567')).toBe(1234567)
    expect(parseCurrencyInput('1.5')).toBe(1.5)
    expect(parseCurrencyInput('1234.5')).toBe(1234.5)
  })

  it('reads exponent form at face value', () => {
    // `String()` emits exponent form past 1e21, so a stored amount round-trips
    // through the editor as `1e+21`. Treating the `e` as decoration to strip
    // read that back as 121 — a silent 19-orders-of-magnitude loss on the next
    // edit of an untouched cell.
    expect(parseCurrencyInput('1e5')).toBe(100000)
    expect(parseCurrencyInput('1e+21')).toBe(1e21)
    expect(parseCurrencyInput('1.5e-3')).toBe(0.0015)
    expect(parseCurrencyInput('-1e5')).toBe(-100000)
    expect(parseCurrencyInput('(1e5)')).toBe(-100000)
    expect(parseCurrencyInput('$1e5')).toBe(100000)
  })

  it('does not mistake an ISO code or prose for an exponent', () => {
    // `EUR` survives the symbol strip with its `E` intact; it must still parse
    // through the ordinary separator path.
    expect(parseCurrencyInput('12 EUR')).toBe(12)
    expect(parseCurrencyInput('EUR 12,50')).toBe(12.5)
    expect(parseCurrencyInput('Revenue 5')).toBe(5)
  })

  it('round-trips a magnitude that stringifies to exponent form', () => {
    expect(parseCurrencyInput(formatCurrencyForInput(1e21))).toBe(1e21)
  })

  it('rejects values carrying no amount', () => {
    expect(parseCurrencyInput('')).toBeNull()
    expect(parseCurrencyInput('   ')).toBeNull()
    expect(parseCurrencyInput('n/a')).toBeNull()
    expect(parseCurrencyInput('$')).toBeNull()
    expect(parseCurrencyInput(null)).toBeNull()
    expect(parseCurrencyInput(undefined)).toBeNull()
    expect(parseCurrencyInput(true)).toBeNull()
    expect(parseCurrencyInput(['12'])).toBeNull()
    expect(parseCurrencyInput({ amount: 12 })).toBeNull()
  })

  it('round-trips its own display output', () => {
    for (const amount of [0, 12, -12.5, 1234.56, 1234567.89]) {
      const rendered = formatCurrencyDisplay(amount, 'USD', 'en-US')
      expect(parseCurrencyInput(rendered)).toBe(amount)
    }
  })
})

describe('formatCurrencyDisplay', () => {
  it('uses the currency’s own symbol and fraction digits', () => {
    expect(formatCurrencyDisplay(1234.56, 'USD', 'en-US')).toBe('$1,234.56')
    // JPY has no minor unit, so it rounds to whole yen.
    expect(formatCurrencyDisplay(1234.56, 'JPY', 'en-US')).toBe('¥1,235')
  })

  it('falls back to the default currency when the column declares none', () => {
    expect(formatCurrencyDisplay(12, undefined, 'en-US')).toBe(
      formatCurrencyDisplay(12, DEFAULT_CURRENCY_CODE, 'en-US')
    )
  })

  it('renders an unreadable value verbatim rather than blanking it', () => {
    // What a string → currency conversion can leave behind.
    expect(formatCurrencyDisplay('pending', 'USD', 'en-US')).toBe('pending')
    expect(formatCurrencyDisplay(null, 'USD', 'en-US')).toBe('')
  })

  it('formats a stored string as if it were the number it encodes', () => {
    expect(formatCurrencyDisplay('1234.56', 'USD', 'en-US')).toBe('$1,234.56')
  })
})

describe('formatCurrencyForInput', () => {
  it('renders the bare amount, with no symbol or grouping', () => {
    expect(formatCurrencyForInput(1234.56)).toBe('1234.56')
    expect(formatCurrencyForInput('$1,234.56')).toBe('1234.56')
    expect(formatCurrencyForInput(null)).toBe('')
    expect(formatCurrencyForInput(undefined)).toBe('')
  })

  it('keeps unparseable text so an edit does not silently erase it', () => {
    expect(formatCurrencyForInput('pending')).toBe('pending')
  })
})

describe('currency codes', () => {
  it('accepts ISO 4217 codes case-insensitively and rejects the rest', () => {
    expect(isSupportedCurrencyCode('USD')).toBe(true)
    expect(isSupportedCurrencyCode('eur')).toBe(true)
    expect(isSupportedCurrencyCode('ZZZ')).toBe(false)
    expect(isSupportedCurrencyCode('US')).toBe(false)
    expect(isSupportedCurrencyCode('DOLLAR')).toBe(false)
    expect(isSupportedCurrencyCode('')).toBe(false)
  })

  it('upper-cases and defaults', () => {
    expect(resolveCurrencyCode('eur')).toBe('EUR')
    expect(resolveCurrencyCode(undefined)).toBe(DEFAULT_CURRENCY_CODE)
    expect(resolveCurrencyCode('')).toBe(DEFAULT_CURRENCY_CODE)
  })

  it('offers the pinned codes first and no duplicates', () => {
    expect(CURRENCY_OPTIONS[0].code).toBe('USD')
    const codes = CURRENCY_OPTIONS.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).toContain('JPY')
  })
})
