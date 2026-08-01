/**
 * Helpers for the `currency` column type.
 *
 * A currency cell stores a **plain JSON number** — the same storage shape as a
 * `number` column — and the column carries a `currencyCode` (ISO 4217) as pure
 * display metadata. That split is deliberate: filtering, sorting, uniqueness,
 * and CSV export all reuse the numeric paths unchanged, changing a column's
 * currency never rewrites a single cell, and the public row output stays a
 * number rather than a locale-formatted string consumers would have to reparse.
 */

/** Currency assumed when a column declares none. */
export const DEFAULT_CURRENCY_CODE = 'USD'

/** A bare numeric literal in exponent form, e.g. `1e+21` or `-1.5e-3`. */
const EXPONENT_LITERAL = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/

/**
 * Invisible bidi control marks. `Intl` wraps RTL-locale output in them, so a
 * pasted `‏1,234.56 ‏₪` carries characters that are not part of the amount.
 */
const BIDI_MARKS = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g

/** Minus-sign characters `Intl` emits in place of the ASCII hyphen. */
const UNICODE_MINUS = /[\u2212\u2012\u2013\uFE63\uFF0D]/g

/**
 * A magnitude suffix (`1.2 M`, `5 K`, `3.4 bn`), used only on runtimes that
 * cannot enumerate currency codes \u2014 see {@link isCurrencyMarkerLetters}. Every
 * other runtime rejects these by not recognising them, so this list does not
 * have to be complete.
 */
const SCALE_SUFFIX = /^(?:k|m|b|t|bn|mn|tn|mm|mil|bil|mio|mrd|bio|tsd|mln|md)$/i

/** A letter directly adjacent to a digit: an identifier, not an amount. */
const LETTER_TOUCHING_DIGIT = /\p{L}\d|\d\p{L}/u

/**
 * Currency markers people type that are not ISO 4217 codes. Upper-cased for
 * comparison; `\u0141` and `\u010c` upper-case as expected.
 */
const NON_ISO_CURRENCY_MARKERS = new Set([
  'KR',
  'Z\u0141',
  'K\u010c',
  'LEI',
  'LV',
  'FT',
  'KN',
  'RM',
  'RP',
  'TL',
  'DIN',
  'SR',
])

/**
 * Whether a bare letter token sitting beside a number is a currency marker.
 *
 * An allowlist, deliberately. The alternative is a denylist of everything that
 * is *not* a currency, which has to guess every magnitude abbreviation in every
 * language \u2014 `mio`, `mrd`, `tsd`, `mln`, `bio` \u2014 and silently divides the value
 * by a million for each one it has not thought of. An unknown token now simply
 * fails to strip, so the leftover letters fail {@link AMOUNT_SHAPE} and the
 * input is rejected rather than quietly rescaled.
 *
 * No ISO code collides with a magnitude abbreviation, so nothing legitimate is
 * lost \u2014 `lib/table/__tests__/currency.test.ts` pins that.
 *
 * A runtime that cannot enumerate codes keeps the old permissive behaviour,
 * minus the magnitude words it knows by name; rejecting every letter marker
 * there would break `USD 12.50` outright.
 */
function isCurrencyMarkerLetters(letters: string): boolean {
  const upper = letters.toUpperCase()
  if (NON_ISO_CURRENCY_MARKERS.has(upper)) return true
  if (supportedCurrencyCodes === null) return !SCALE_SUFFIX.test(upper)
  return supportedCurrencyCodes.has(upper)
}

/**
 * A leading currency marker: up to three letters and/or a symbol, optionally
 * behind a sign. The sign is captured so `-$12.50` keeps it, and the letters
 * are captured so {@link isCurrencyMarkerLetters} can vet them.
 */
const CURRENCY_MARKER_PREFIX =
  /^[\s\u00a0\u202f]*([+-]?)[\s\u00a0\u202f]*(?:\p{Sc}\p{L}{0,3}|(\p{L}{1,3})(\p{Sc})?)[\s\u00a0\u202f]*/u

/** The same, trailing. */
const CURRENCY_MARKER_SUFFIX =
  /[\s\u00a0\u202f]*(?:\p{Sc}\p{L}{0,3}|(\p{L}{1,3})(\p{Sc})?)\.?[\s\u00a0\u202f]*$/u

/**
 * Whether a matched marker may be stripped. A marker carrying a currency
 * SYMBOL needs no vetting — no magnitude abbreviation contains one — and
 * `letters === undefined` means the symbol-led alternative matched.
 */
function isStrippableMarker(letters: string | undefined, symbol: string | undefined): boolean {
  if (letters === undefined || symbol !== undefined) return true
  return isCurrencyMarkerLetters(letters)
}

/** Only digits and separators, with at least one digit. */
const AMOUNT_SHAPE = /^[+-]?[\d.,]*\d[\d.,]*$/

/**
 * Whether `text` is validly grouped by `separator`: a first group of 1-3 digits
 * and every later group exactly 3. Rejects `0.1.2` and `1,000,00`, which the
 * plain "strip the separator" reading would silently turn into 12 and 100000.
 */
function hasValidGrouping(text: string, separator: string): boolean {
  const groups = text.split(separator)
  if (groups.length === 1) return true
  if (!/^\d{1,3}$/.test(groups[0])) return false
  const rest = groups.slice(1)
  // Western: every later group is exactly three.
  if (rest.every((group) => /^\d{3}$/.test(group))) return true
  // Indian: the final group is three and the ones before it are two —
  // `12,34,567`. Still rejects `1,000,00`, whose final group is two.
  return (
    rest.length > 1 &&
    /^\d{3}$/.test(rest[rest.length - 1]) &&
    rest.slice(0, -1).every((group) => /^\d{2}$/.test(group))
  )
}

/** A decimal/grouping separator followed by whitespace — a list, not an amount. */
const SEPARATOR_THEN_SPACE = /[.,]\s/

/** An `e` with a digit on both sides — an exponent marker, however spaced. */
const INTERIOR_EXPONENT = /\d\s*[eE][+-]?\s*\d/

/** ISO 4217 alphabetic code: exactly three letters. */
const CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/

/**
 * Codes offered first in the picker. The rest of ICU's set is still selectable
 * (and any valid code is accepted over the API) — these are just the ones worth
 * reaching without typing.
 */
const PINNED_CURRENCY_CODES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
  'CHF',
  'CNY',
  'INR',
  'BRL',
] as const

/**
 * Every ISO 4217 code the runtime knows, or `null` when the runtime predates
 * `Intl.supportedValuesOf` — in which case validation falls back to the shape
 * check alone rather than rejecting codes it cannot enumerate.
 */
const supportedCurrencyCodes: ReadonlySet<string> | null = (() => {
  const supportedValuesOf = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: string) => string[]
    }
  ).supportedValuesOf
  if (typeof supportedValuesOf !== 'function') return null
  try {
    return new Set(supportedValuesOf('currency'))
  } catch {
    return null
  }
})()

/** Whether `code` is a well-formed ISO 4217 code this runtime can format. */
export function isSupportedCurrencyCode(code: string): boolean {
  if (!CURRENCY_CODE_PATTERN.test(code)) return false
  const upper = code.toUpperCase()
  return supportedCurrencyCodes === null || supportedCurrencyCodes.has(upper)
}

/** A column's effective currency code, upper-cased, defaulting to {@link DEFAULT_CURRENCY_CODE}. */
export function resolveCurrencyCode(currencyCode: string | undefined): string {
  return currencyCode ? currencyCode.toUpperCase() : DEFAULT_CURRENCY_CODE
}

export interface CurrencyOption {
  code: string
  /** Localized currency name, e.g. `US Dollar`. Falls back to the code. */
  name: string
}

/**
 * Codes for the column-config picker: the pinned set first, then every other
 * code the runtime supports, alphabetically.
 *
 * Built on first call, not at module load: constructing `Intl.DisplayNames` and
 * naming ~160 currencies costs several milliseconds of ICU work, and the only
 * caller is the column-config sidebar — every table API route imports this
 * module and would otherwise pay for a list it never reads.
 */
let currencyOptions: readonly CurrencyOption[] | null = null

function currencyDisplayNames(): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' })
  } catch {
    return null
  }
}

export function getCurrencyOptions(): readonly CurrencyOption[] {
  if (currencyOptions) return currencyOptions
  const pinned = new Set<string>(PINNED_CURRENCY_CODES)
  const rest = supportedCurrencyCodes
    ? [...supportedCurrencyCodes].filter((code) => !pinned.has(code)).sort()
    : []
  const displayNames = currencyDisplayNames()
  currencyOptions = [...PINNED_CURRENCY_CODES, ...rest].map((code) => ({
    code,
    name: displayNames?.of(code) ?? code,
  }))
  return currencyOptions
}

/**
 * Parses a user-entered or imported amount into a number, tolerating the shapes
 * a currency value arrives in: symbols and ISO codes (`$1,234.56`, `1 234,56 €`,
 * `USD 12`), grouping separators (including the non-breaking spaces several
 * locales use), and accounting negatives (`(1,234.56)` → `-1234.56`).
 *
 * Separator disambiguation, when only commas are present: a single comma
 * followed by exactly three digits is grouping (`1,500` → `1500`); anything
 * else is a decimal comma (`1,50` → `1.5`). `1,500` meaning one-and-a-half is
 * therefore read as fifteen hundred — a known ambiguity that resolves in favor
 * of the far more common reading.
 *
 * Two input families are deliberately refused rather than guessed at, because
 * both would otherwise be misread as an amount rather than rejected:
 *
 * - Markers written flush against the digits (`Rp12,00`). A letter touching a
 *   digit is the only thing separating a currency marker from a part number,
 *   and reading `SKU400` as 400 invents a value where refusing merely
 *   inconveniences. Markers separated by a space or a symbol all work.
 * - Locales formatting with their own numeral systems (Arabic-Indic `١٢٣`).
 *   Supporting them is a wider decision than this type, since it would also
 *   touch `number`, display, and sorting.
 *
 * Both fail closed — `null`, never a wrong number.
 *
 * Returns `null` when no amount can be read, so callers can distinguish
 * "unparseable" from a legitimate `0`.
 */
export function parseCurrencyInput(raw: unknown, currencyCode?: string): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null

  // `Intl` emits U+2212 MINUS SIGN (and locale-specific dashes) rather than the
  // ASCII hyphen for negatives in several locales, so a pasted `−12,50 kr`
  // would otherwise fail to read as negative.
  const trimmed = raw.trim().replace(BIDI_MARKS, '').replace(UNICODE_MINUS, '-')
  if (trimmed === '') return null

  const parenthesized = /^\((.*)\)$/.exec(trimmed)
  const body = parenthesized ? parenthesized[1] : trimmed

  // No real amount puts whitespace after a separator, but a delimited LIST
  // does — and a multi-select column flattens to exactly that when it converts.
  // Without this, `12, 34` reads as 12.34 and `100, 200` as 100200, so a
  // multi-select column of numeric option names would convert to nonsense.
  if (SEPARATOR_THEN_SPACE.test(body)) return null

  // Exponent form is taken at face value. `String()` emits it for any magnitude
  // past 1e21, so a stored amount round-trips through the editor as `1e+21` —
  // and stripping the `e` as decoration would read that back as 121, silently
  // losing 19 orders of magnitude.
  const exponentCandidate = body.replace(/[^\d.,\-+eE]/g, '')
  if (EXPONENT_LITERAL.test(exponentCandidate)) {
    const parsed = Number(exponentCandidate)
    if (Number.isFinite(parsed)) return parenthesized ? -Math.abs(parsed) : parsed
  }
  // An `e` sitting between digits is an exponent marker, not decoration. If the
  // string is not a clean literal we cannot read it unambiguously, and dropping
  // the `e` would join the digit groups and change the magnitude (`1e5 EUR`
  // would become 15) — so refuse instead of guessing. The digit on BOTH sides
  // is what distinguishes this from the `E` inside an ISO code like `12 EUR`.
  if (INTERIOR_EXPONENT.test(body)) return null

  // A letter touching a digit means this is an identifier, not an amount —
  // `SKU400`, `ABC1234`. Currency markers are always separated from the number
  // by a space or a symbol, so this distinguishes them without a symbol list.
  if (LETTER_TOUCHING_DIGIT.test(body)) return null

  // Strip the currency marker: up to three letters (an ISO code, `kr`, `zł`)
  // optionally joined to a symbol (`R$`, `CHF`), at either end. Only a marker
  // that actually NAMES a currency is stripped — a magnitude word like `1.2 M`
  // or `3,4 mrd` is left in place, so it fails the amount-shape check below
  // instead of silently reading as 1.2, orders of magnitude too small.
  // Whether a marker was actually stripped decides one ambiguous case below —
  // see {@link loneSeparatorIsGrouping}.
  let hadMarker = false
  const withoutPrefix = body.replace(CURRENCY_MARKER_PREFIX, (match, sign, letters, symbol) => {
    if (!isStrippableMarker(letters, symbol)) return match
    hadMarker = true
    return sign
  })
  const withoutMarkers = withoutPrefix.replace(CURRENCY_MARKER_SUFFIX, (match, letters, symbol) => {
    if (!isStrippableMarker(letters, symbol)) return match
    hadMarker = true
    return ''
  })
  const cleaned = withoutMarkers.replace(/[\s\u00a0\u202f\u2019']/gu, '')
  // What remains must be ONLY digits and separators. Anything else — a
  // US-format date, leftover prose — is not an amount.
  if (!AMOUNT_SHAPE.test(cleaned)) return null

  const signed = /^[+-]/.test(cleaned)
  const digitsAndSeps = signed ? cleaned.slice(1) : cleaned
  const negative = parenthesized !== null || (signed && cleaned.startsWith('-'))

  const lastComma = digitsAndSeps.lastIndexOf(',')
  const lastDot = digitsAndSeps.lastIndexOf('.')
  let normalized: string
  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: whichever comes last is the decimal separator.
    const decimalSeparator = lastComma > lastDot ? ',' : '.'
    const groupSeparator = decimalSeparator === ',' ? '.' : ','
    const [integerPart, ...decimalParts] = digitsAndSeps.split(decimalSeparator)
    if (decimalParts.length > 1 || !hasValidGrouping(integerPart, groupSeparator)) return null
    normalized = `${integerPart.split(groupSeparator).join('')}.${decimalParts[0]}`
  } else if (lastComma !== -1) {
    const repeated = digitsAndSeps.indexOf(',') !== lastComma
    const grouping =
      repeated || loneSeparatorIsGrouping(digitsAndSeps, ',', currencyCode, hadMarker)
    if (grouping) {
      if (!hasValidGrouping(digitsAndSeps, ',')) return null
      normalized = digitsAndSeps.split(',').join('')
    } else {
      normalized = digitsAndSeps.replace(',', '.')
    }
  } else if (lastDot !== -1) {
    const repeated = digitsAndSeps.indexOf('.') !== lastDot
    const grouping =
      repeated || loneSeparatorIsGrouping(digitsAndSeps, '.', currencyCode, hadMarker)
    if (grouping) {
      if (!hasValidGrouping(digitsAndSeps, '.')) return null
      normalized = digitsAndSeps.split('.').join('')
    } else {
      normalized = digitsAndSeps
    }
  } else {
    normalized = digitsAndSeps
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return negative ? -parsed : parsed
}

/**
 * Whether a lone separator followed by exactly three digits is grouping rather
 * than a decimal point.
 *
 * The separator decides, tempered by what the currency can express:
 *
 * - A **dot** is the decimal point in the notation most people type, so it
 *   stays a decimal — typing `1.234` in a USD cell means 1.234, which the
 *   display then rounds to `$1.23`, exactly as a spreadsheet does. Reading it
 *   as 1,234 would be a thousandfold surprise.
 * - A **comma** is grouping by convention — `1,500` is fifteen hundred, not one
 *   and a half. The exception: a currency with three decimal places (KWD, TND)
 *   legitimately ends in three digits after its separator, so `0,500` is a half.
 *
 * The one case where a dot groups is a currency with NO decimal places, and
 * only when a currency marker came with it. `1.235 ¥` cannot be a fraction of a
 * yen, and is the single lone-separator form a formatter emits — but a formatter
 * always emits its marker too. A bare `1.235` is someone typing, and inflating
 * that to 1235 is a silent thousandfold error, where reading it literally stores
 * 1.235 and displays `¥1` — wrong in a way the writer can see and correct.
 *
 * The marker carries no information for any other currency: one with one or two
 * decimal places always formats with BOTH separators, so a lone separator there
 * never came from a formatter in the first place.
 */
function loneSeparatorIsGrouping(
  digitsAndSeps: string,
  separator: string,
  currencyCode: string | undefined,
  hadMarker: boolean
): boolean {
  if (!new RegExp(`\\${separator}\\d{3}$`).test(digitsAndSeps)) return false
  const fractionDigits = currencyFractionDigits(currencyCode)
  return separator === ',' ? fractionDigits !== 3 : fractionDigits === 0 && hadMarker
}

/** A currency's conventional decimal places, defaulting to 2 when unknown. */
function currencyFractionDigits(currencyCode: string | undefined): number {
  if (!currencyCode) return 2
  const formatter = currencyFormatter(resolveCurrencyCode(currencyCode), undefined)
  return formatter?.resolvedOptions().maximumFractionDigits ?? 2
}

/**
 * Formatters are cached by locale + code: a grid paints thousands of currency
 * cells per scroll, and constructing an `Intl.NumberFormat` per cell is orders
 * of magnitude more expensive than the format call itself.
 */
const formatterCache = new Map<string, Intl.NumberFormat | null>()

function currencyFormatter(
  currencyCode: string,
  locale: string | undefined
): Intl.NumberFormat | null {
  const key = `${locale ?? ''}:${currencyCode}`
  const cached = formatterCache.get(key)
  if (cached !== undefined) return cached
  let formatter: Intl.NumberFormat | null
  try {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode })
  } catch {
    formatter = null
  }
  formatterCache.set(key, formatter)
  return formatter
}

/**
 * Formats a stored cell for display — symbol placement and fraction digits come
 * from the currency itself, so `JPY` renders `¥1,235` while `USD` renders
 * `$1,234.56`. Values that carry no readable amount (a string left behind by a
 * `string` → `currency` conversion, say) render verbatim rather than blanking,
 * and an unformattable code degrades to `CODE amount`.
 *
 * `locale` is left to the caller's runtime by default, which means the viewer's
 * own grouping/decimal conventions in the browser.
 */
export function formatCurrencyDisplay(
  value: unknown,
  currencyCode: string | undefined,
  locale?: string
): string {
  const amount = parseCurrencyInput(value)
  if (amount === null) return typeof value === 'string' ? value : ''
  const code = resolveCurrencyCode(currencyCode)
  const formatter = currencyFormatter(code, locale)
  return formatter ? formatter.format(amount) : `${code} ${amount}`
}

/**
 * Renders a stored cell for a text input: the bare amount, with no symbol or
 * grouping, so editing round-trips through {@link parseCurrencyInput} exactly.
 */
export function formatCurrencyForInput(value: unknown): string {
  if (value === null || value === undefined) return ''
  const amount = parseCurrencyInput(value)
  if (amount !== null) return String(amount)
  return typeof value === 'string' ? value : ''
}
