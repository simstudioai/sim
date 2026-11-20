/**
 * Display helpers for the `currency` column type: the grid's formatted amount, the editor's bare
 * amount, and the column-config picker's code list. Parsing and validation live in
 * `@sim/table-cells/currency`, shared with the CLI's offline row check.
 */

import {
  listSupportedCurrencyCodes,
  parseCurrencyInput,
  resolveCurrencyCode,
} from '@sim/table-cells/currency'
import { LRUCache } from 'lru-cache'

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

/** One picker entry. */
export interface CurrencyOption {
  code: string
  /** Localized currency name, e.g. `US Dollar`. Falls back to the code. */
  name: string
}

/**
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

/**
 * Codes for the column-config picker: the pinned set first, then every other
 * code the runtime supports, alphabetically.
 */
export function getCurrencyOptions(): readonly CurrencyOption[] {
  if (currencyOptions) return currencyOptions
  const pinned = new Set<string>(PINNED_CURRENCY_CODES)
  const rest = listSupportedCurrencyCodes()
    .filter((code) => !pinned.has(code))
    .sort()
  const displayNames = currencyDisplayNames()
  currencyOptions = [...PINNED_CURRENCY_CODES, ...rest].map((code) => ({
    code,
    name: displayNames?.of(code) ?? code,
  }))
  return currencyOptions
}

/** Formatters a grid keeps live: one per locale and code it paints. */
const MAX_CACHED_FORMATTERS = 256

/**
 * Formatters are cached by locale + code: a grid paints thousands of currency
 * cells per scroll, and constructing an `Intl.NumberFormat` per cell is orders
 * of magnitude more expensive than the format call itself. `false` records a
 * code the runtime cannot format.
 */
const formatterCache = new LRUCache<string, Intl.NumberFormat | false>({
  max: MAX_CACHED_FORMATTERS,
})

function currencyFormatter(
  currencyCode: string,
  locale: string | undefined
): Intl.NumberFormat | null {
  const key = `${locale ?? ''}:${currencyCode}`
  const cached = formatterCache.get(key)
  if (cached !== undefined) return cached || null
  let formatter: Intl.NumberFormat | null
  try {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode })
  } catch {
    formatter = null
  }
  formatterCache.set(key, formatter ?? false)
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
