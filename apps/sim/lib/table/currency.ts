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
  return /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((group) => /^\d{3}$/.test(group))
}

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
 * Returns `null` when no amount can be read, so callers can distinguish
 * "unparseable" from a legitimate `0`.
 */
export function parseCurrencyInput(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim()
  if (trimmed === '') return null

  const parenthesized = /^\((.*)\)$/.exec(trimmed)
  const body = parenthesized ? parenthesized[1] : trimmed

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

  // What remains once currency symbols, spacing, and an ISO code are removed
  // must be ONLY digits and separators. Scraping digits out of anything else
  // invents a value: a US-format date, a SKU, or a room number would all parse.
  const cleaned = body
    .replace(/\p{Sc}/gu, '')
    .replace(/\s/g, '')
    .replace(/^[A-Za-z]{3}|[A-Za-z]{3}$/g, '')
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
    // A single comma followed by exactly three digits is grouping (`1,500`);
    // anything else is a decimal comma (`1,50`).
    const grouping = digitsAndSeps.indexOf(',') !== lastComma || /,\d{3}$/.test(digitsAndSeps)
    if (grouping) {
      if (!hasValidGrouping(digitsAndSeps, ',')) return null
      normalized = digitsAndSeps.split(',').join('')
    } else {
      normalized = digitsAndSeps.replace(',', '.')
    }
  } else if (lastDot !== -1 && digitsAndSeps.indexOf('.') !== lastDot) {
    // More than one dot can only be grouping: `1.234.567`.
    if (!hasValidGrouping(digitsAndSeps, '.')) return null
    normalized = digitsAndSeps.split('.').join('')
  } else {
    normalized = digitsAndSeps
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return negative ? -parsed : parsed
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
