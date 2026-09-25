/**
 * Guards for the `currency` column type. The parser is the load-bearing piece:
 * filters and sorts cast a currency cell to `numeric`, so anything it lets
 * through unparsed would break every query against the column.
 */
import { describe, expect, it } from 'vitest'
import {
  formatCurrencyDisplay,
  formatCurrencyForInput,
  parseCurrencyInput,
} from '@/lib/table/currency'

describe('parseCurrencyInput', () => {
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

  it('does not mistake an ISO code for an exponent', () => {
    // `EUR` survives the symbol strip with its `E` intact; it must still parse
    // through the ordinary separator path.
    expect(parseCurrencyInput('12 EUR')).toBe(12)
    expect(parseCurrencyInput('EUR 12,50')).toBe(12.5)
    expect(parseCurrencyInput('USD 1,234.56')).toBe(1234.56)
  })

  it('rejects a sign that is not leading, so dates do not read as amounts', () => {
    // A date column converting to currency previously turned `2024-01-01` into
    // 20240101 — the hyphens were dropped as decoration and the digit groups
    // joined. Every cell in the column would have been silently corrupted.
    expect(parseCurrencyInput('2024-01-01')).toBeNull()
    expect(parseCurrencyInput('2024-01-01T10:30:00Z')).toBeNull()
    expect(parseCurrencyInput('1-2-3')).toBeNull()
    expect(parseCurrencyInput('12--3')).toBeNull()
    // A leading sign is still a sign.
    expect(parseCurrencyInput('-12')).toBe(-12)
    expect(parseCurrencyInput('+12')).toBe(12)
    expect(parseCurrencyInput('-$12.50')).toBe(-12.5)
  })

  it('parses what Intl emits, across locales and signs', () => {
    // The realistic input: a user pastes a cell from a spreadsheet. Generated
    // rather than hand-listed so a parser change cannot quietly regress a
    // locale nobody thought to write down.
    const pairs: Array<[string, string]> = [
      ['en-US', 'USD'],
      ['de-DE', 'EUR'],
      ['fr-FR', 'EUR'],
      ['pt-BR', 'BRL'],
      ['en-IN', 'INR'],
      ['ja-JP', 'JPY'],
      ['en-GB', 'GBP'],
      ['de-CH', 'CHF'],
      ['sv-SE', 'SEK'],
      ['da-DK', 'DKK'],
      ['pl-PL', 'PLN'],
      ['ru-RU', 'RUB'],
      ['it-IT', 'EUR'],
      ['nl-NL', 'EUR'],
      ['tr-TR', 'TRY'],
      ['ko-KR', 'KRW'],
      ['zh-CN', 'CNY'],
      ['en-CA', 'CAD'],
      ['en-AU', 'AUD'],
      ['he-IL', 'ILS'],
    ]
    const amounts = [0, 12, 1234.56, 1234567.89, -12.5, -1234.56]

    for (const [locale, currency] of pairs) {
      for (const amount of amounts) {
        const formatted = new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
        }).format(amount)
        const parsed = parseCurrencyInput(formatted)
        expect(parsed, `${locale}/${currency} ${JSON.stringify(formatted)}`).not.toBeNull()
        // Zero-decimal currencies round, so compare within one unit.
        expect(
          Math.abs((parsed as number) - amount),
          `${locale}/${currency} ${JSON.stringify(formatted)} -> ${parsed}`
        ).toBeLessThanOrEqual(1)
      }
    }
  })

  it('parses the locale formats of the currencies the picker pins', () => {
    // These are exactly what `Intl.NumberFormat` emits, i.e. what a user pastes
    // from a spreadsheet. Rejecting them would make the pinned currencies
    // unusable in their own conventional notation.
    expect(parseCurrencyInput('R$ 1.234,56')).toBe(1234.56)
    expect(parseCurrencyInput('₹12,34,567.89')).toBe(1234567.89)
    expect(parseCurrencyInput('1 234,56 kr')).toBe(1234.56)
    expect(parseCurrencyInput('1.234,56 kr.')).toBe(1234.56)
    expect(parseCurrencyInput('1234,56 zł')).toBe(1234.56)
    expect(parseCurrencyInput('CHF 1’234.56')).toBe(1234.56)
  })

  it('reads a lone dot as the decimal point people type', () => {
    // Typing `1.234` in a USD cell means 1.234, which the display rounds to
    // $1.23 exactly as a spreadsheet does. Reading it as 1,234 would be a
    // thousandfold surprise, marker or no marker.
    expect(parseCurrencyInput('$1.234', 'USD')).toBe(1.234)
    expect(parseCurrencyInput('1.234')).toBe(1.234)
    expect(parseCurrencyInput('1.234', 'EUR')).toBe(1.234)
  })

  it('groups a lone dot only for a zero-decimal currency that came formatted', () => {
    // `1.235 ¥` cannot be a fraction of a yen, and is the single lone-separator
    // form a formatter emits — but a formatter always emits its marker too.
    expect(parseCurrencyInput('1.235 ¥', 'JPY')).toBe(1235)
    expect(parseCurrencyInput('JPY 1.235', 'JPY')).toBe(1235)
    // Bare, it is someone typing. Inflating that to 1235 would be a silent
    // thousandfold error; read literally it stores 1.235 and displays ¥1 —
    // wrong in a way the writer can see and fix.
    expect(parseCurrencyInput('1.235', 'JPY')).toBe(1.235)
    expect(parseCurrencyInput('1.235', 'CLP')).toBe(1.235)
  })

  it('reads a lone comma as grouping, except where the currency has three decimals', () => {
    // `1,500` is fifteen hundred by convention. A three-decimal currency's
    // trailing three digits are decimals however the value arrived — which
    // matters most for CSV import, where nothing carries a marker.
    expect(parseCurrencyInput('1,500', 'USD')).toBe(1500)
    expect(parseCurrencyInput('1,500')).toBe(1500)
    expect(parseCurrencyInput('0,500', 'KWD')).toBe(0.5)
    expect(parseCurrencyInput('0,500 KWD', 'KWD')).toBe(0.5)
    expect(parseCurrencyInput('12,000', 'TND')).toBe(12)
    expect(parseCurrencyInput('12,000 TND', 'TND')).toBe(12)
  })

  it('refuses a scale suffix rather than shrinking the value', () => {
    // `1.2 M` read as 1.2 would rewrite a column of millions a millionfold too
    // small — the same invented-value failure as an identifier, inverted.
    expect(parseCurrencyInput('1.2 M')).toBeNull()
    expect(parseCurrencyInput('5 K')).toBeNull()
    expect(parseCurrencyInput('3.4 bn')).toBeNull()
    expect(parseCurrencyInput('10 B')).toBeNull()
    // `kr` is a currency marker, not a scale suffix, despite starting with k.
    expect(parseCurrencyInput('1 234,56 kr')).toBe(1234.56)
  })

  it('refuses non-English magnitude words too', () => {
    // These are why the marker check is an allowlist. As a denylist each one
    // had to be named, and any that was missed read as a bare number — `1,2
    // mio` as 1.2 rather than 1.2 million.
    expect(parseCurrencyInput('1,2 mio')).toBeNull()
    expect(parseCurrencyInput('3,4 mrd')).toBeNull()
    expect(parseCurrencyInput('5 tsd')).toBeNull()
    expect(parseCurrencyInput('2,5 mln')).toBeNull()
    expect(parseCurrencyInput('1,5 bio')).toBeNull()
    expect(parseCurrencyInput('7 md')).toBeNull()
    // Anything else beside a number is refused by the same rule, so the parser
    // no longer has to enumerate what a magnitude word looks like.
    expect(parseCurrencyInput('12 units')).toBeNull()
    expect(parseCurrencyInput('12 pcs')).toBeNull()
  })

  it('keeps every ISO code strippable — no code is a magnitude word', () => {
    // The allowlist is only safe because these two sets do not overlap. If a
    // future ISO code ever collided with a magnitude abbreviation, this fails
    // and the marker rule needs a tiebreak.
    const codes = new Set(
      (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf(
        'currency'
      )
    )
    const magnitudeWords = ['K', 'M', 'B', 'T', 'BN', 'MN', 'MIO', 'MRD', 'TSD', 'MLN', 'BIO', 'MD']
    expect(magnitudeWords.filter((w) => codes.has(w))).toEqual([])
  })

  it('rejects an identifier whose letters touch its digits', () => {
    // The distinguishing rule: a currency marker is always separated from the
    // number by a space or a symbol, so letters touching digits mean this is a
    // part number, not an amount. Without it, converting a column of SKUs to
    // currency rewrote every cell with an invented value.
    expect(parseCurrencyInput('SKU400')).toBeNull()
    expect(parseCurrencyInput('ABC1234')).toBeNull()
    expect(parseCurrencyInput('A1B2')).toBeNull()
    // A marker separated properly still parses.
    expect(parseCurrencyInput('USD 400')).toBe(400)
    expect(parseCurrencyInput('$400')).toBe(400)
  })

  it('rejects text that merely contains digits', () => {
    // Scraping digits out of arbitrary text invents a value. A string column of
    // SKUs, phone numbers, or US-format dates converting to currency would
    // otherwise report zero incompatible rows and rewrite every cell.
    expect(parseCurrencyInput('01/02/2024')).toBeNull()
    expect(parseCurrencyInput('Room 101')).toBeNull()
    expect(parseCurrencyInput('Invoice 2024')).toBeNull()
    expect(parseCurrencyInput('1_000')).toBeNull()
  })

  it('rejects malformed separator runs and invalid grouping', () => {
    // `0.1.2` and `1,000,00` would read as 12 and 100000 under a plain
    // strip-the-separator rule.
    expect(parseCurrencyInput('1..2')).toBeNull()
    expect(parseCurrencyInput('1,,2')).toBeNull()
    expect(parseCurrencyInput('0.1.2')).toBeNull()
    expect(parseCurrencyInput('1,000,00')).toBeNull()
    // Valid grouping still works, western and Indian.
    expect(parseCurrencyInput('1.234.567')).toBe(1234567)
    expect(parseCurrencyInput('1,234,567.89')).toBe(1234567.89)
    expect(parseCurrencyInput('12,34,567')).toBe(1234567)
  })

  it('round-trips its own display output', () => {
    for (const amount of [0, 12, -12.5, 1234.56, 1234567.89]) {
      const rendered = formatCurrencyDisplay(amount, 'USD', 'en-US')
      expect(parseCurrencyInput(rendered)).toBe(amount)
    }
  })
})

describe('formatCurrencyDisplay', () => {
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
