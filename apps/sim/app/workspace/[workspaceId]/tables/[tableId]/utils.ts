import type { ColumnDefinition } from '@/lib/table'
import { getColumnStorageType, RATING_MAX } from '@/lib/table/constants'

/**
 * Number formatters for currency/percent cells, created lazily on first
 * format call. Cell values only render after the client-side row fetch, so
 * these always initialize in the browser with `navigator.language` — never at
 * module load during SSR, where the locale would diverge and risk hydration
 * mismatches. USD is the default display currency until per-column currency
 * config exists.
 */
let currencyFormatter: Intl.NumberFormat | undefined
let percentFormatter: Intl.NumberFormat | undefined

function displayLocale(): string {
  return typeof navigator === 'undefined' ? 'en-US' : navigator.language
}

/** Formats a currency cell's numeric value for display in the user's locale. */
export function formatCurrencyDisplay(value: number): string {
  currencyFormatter ??= new Intl.NumberFormat(displayLocale(), {
    style: 'currency',
    currency: 'USD',
  })
  return currencyFormatter.format(value)
}

/** Formats a percent cell's numeric value for display, e.g. `12.5` → `12.5%`. */
export function formatPercentDisplay(value: number): string {
  percentFormatter ??= new Intl.NumberFormat(displayLocale(), { maximumFractionDigits: 2 })
  return `${percentFormatter.format(value)}%`
}

/**
 * Tag palette for select values. The variant is derived from a hash of the
 * value so a given option keeps its color across rows, reloads, and option
 * reordering without persisting color state.
 */
const SELECT_BADGE_VARIANTS = [
  'green',
  'blue',
  'purple',
  'orange',
  'teal',
  'cyan',
  'pink',
  'amber',
] as const

export function selectBadgeVariant(value: string): (typeof SELECT_BADGE_VARIANTS)[number] {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return SELECT_BADGE_VARIANTS[Math.abs(hash) % SELECT_BADGE_VARIANTS.length]
}

/**
 * Pick a fresh "untitled[_N]" name not already taken by `columns`. Used by
 * both the page-header and inline-header "New column" dropdowns.
 */
export function generateColumnName(columns: ReadonlyArray<{ name: string }>): string {
  const existing = new Set(columns.map((c) => c.name.toLowerCase()))
  let name = 'untitled'
  let i = 2
  while (existing.has(name.toLowerCase())) {
    name = `untitled_${i}`
    i++
  }
  return name
}

/**
 * Coerce a raw input value to the appropriate storage primitive for a column.
 * Rich types coerce as their primitive (e.g. `currency` parses as a number);
 * `rating` additionally rounds and clamps to 0..{@link RATING_MAX} so star
 * edits always land on a renderable value. Throws on invalid JSON.
 */
export function cleanCellValue(value: unknown, column: ColumnDefinition): unknown {
  const storageType = getColumnStorageType(column.type)
  if (storageType === 'number') {
    if (value === '') return null
    const num = Number(value)
    if (Number.isNaN(num)) return null
    if (column.type === 'rating') {
      return Math.min(RATING_MAX, Math.max(0, Math.round(num)))
    }
    return num
  }
  if (storageType === 'json') {
    if (typeof value === 'string') {
      if (value === '') return null
      return JSON.parse(value)
    }
    return value
  }
  if (storageType === 'boolean') {
    return Boolean(value)
  }
  if (storageType === 'date') {
    if (value === '' || value === null || value === undefined) return null
    const str = String(value)
    return Number.isNaN(Date.parse(str)) ? null : str
  }
  return value || null
}

/**
 * Format a stored value for display in an input field. Defensive against
 * shape drift: a column whose declared type lags its actual data (e.g. a
 * workflow column mid-remap, where the schema cache hasn't refetched but
 * row data already has the new mapping's value) would otherwise render
 * `[object Object]` via `String(value)`.
 */
export function formatValueForInput(value: unknown, type: string): string {
  if (value === null || value === undefined) return ''
  const storageType = getColumnStorageType(type)
  if (storageType === 'json') {
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
  if (storageType === 'date' && value) {
    const str = String(value)
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (match) return match[0]
    try {
      const date = new Date(str)
      return date.toISOString().split('T')[0]
    } catch {
      return str
    }
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Convert a stored YYYY-MM-DD date string to MM/DD/YYYY display format.
 */
export function storageToDisplay(stored: string): string {
  const match = stored.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[2]}/${match[3]}/${match[1]}`
  return stored
}

/**
 * Convert a MM/DD/YYYY (or MM/DD) display string back to YYYY-MM-DD storage format.
 */
export function displayToStorage(display: string): string | null {
  const iso = display.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const month = Number(iso[2])
    const day = Number(iso[3])
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return display
  }
  const full = display.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (full) {
    const month = Number(full[1])
    const day = Number(full[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${full[3]}-${full[1].padStart(2, '0')}-${full[2].padStart(2, '0')}`
  }
  const partial = display.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (partial) {
    const month = Number(partial[1])
    const day = Number(partial[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${new Date().getFullYear()}-${partial[1].padStart(2, '0')}-${partial[2].padStart(2, '0')}`
  }
  return null
}
