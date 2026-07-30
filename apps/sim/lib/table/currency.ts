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
 * code the runtime supports, alphabetically. Computed once at module load —
 * the list is fixed for the process lifetime.
 */
export const CURRENCY_OPTIONS: readonly CurrencyOption[] = (() => {
  const pinned = new Set<string>(PINNED_CURRENCY_CODES)
  const rest = supportedCurrencyCodes
    ? [...supportedCurrencyCodes].filter((code) => !pinned.has(code)).sort()
    : []
  const displayNames = currencyDisplayNames()
  return [...PINNED_CURRENCY_CODES, ...rest].map((code) => ({
    code,
    name: displayNames?.of(code) ?? code,
  }))
})()

function currencyDisplayNames(): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' })
  } catch {
    return null
  }
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

  // Exponent form first, and taken at face value. `String()` emits it for any
  // magnitude past 1e21, so a stored amount round-trips through the editor as
  // `1e+21` — and stripping the `e` as decoration would read that back as 121,
  // silently losing 19 orders of magnitude. Only a string that is *wholly* a
  // numeric literal once symbols are removed qualifies, so `12 EUR` (whose `E`
  // survives the strip) still falls through to the separator logic below.
  const exponentCandidate = body.replace(/[^\d.,\-+eE]/g, '')
  if (/[eE]/.test(exponentCandidate)) {
    const parsed = Number(exponentCandidate)
    if (Number.isFinite(parsed)) {
      return parenthesized ? -Math.abs(parsed) : parsed
    }
  }

  // Drop symbols, letters, and every flavor of space, leaving only digits, the
  // two separator characters, and a leading sign.
  const stripped = body.replace(/[^\d.,\-+]/g, '')
  if (!/\d/.test(stripped)) return null

  const negative = parenthesized !== null || stripped.startsWith('-')
  const digitsAndSeps = stripped.replace(/[+-]/g, '')

  const lastComma = digitsAndSeps.lastIndexOf(',')
  const lastDot = digitsAndSeps.lastIndexOf('.')
  let normalized: string
  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: whichever comes last is the decimal separator.
    const decimalSeparator = lastComma > lastDot ? ',' : '.'
    const groupSeparator = decimalSeparator === ',' ? '.' : ','
    normalized = digitsAndSeps.split(groupSeparator).join('').replace(decimalSeparator, '.')
  } else if (lastComma !== -1) {
    const grouping = digitsAndSeps.indexOf(',') !== lastComma || /,\d{3}$/.test(digitsAndSeps)
    normalized = grouping ? digitsAndSeps.split(',').join('') : digitsAndSeps.replace(',', '.')
  } else if (lastDot !== -1 && digitsAndSeps.indexOf('.') !== lastDot) {
    // More than one dot can only be grouping: `1.234.567`.
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
