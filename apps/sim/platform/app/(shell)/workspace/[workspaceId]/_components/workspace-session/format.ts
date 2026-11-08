import type { DashboardUnit } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'

const LOCALE = 'en-US'
const MISSING = '—'
/** Past seven digits a count reads more easily in compact notation. */
const EXACT_LIMIT = 10_000_000

const count = new Intl.NumberFormat(LOCALE)
const compactCount = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const percent = new Intl.NumberFormat(LOCALE, {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const signedPercent = new Intl.NumberFormat(LOCALE, {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
})
const units = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 })
const currencies = new Map<string, { exact: Intl.NumberFormat; compact: Intl.NumberFormat }>()

function currencyFormat(currency: string) {
  let format = currencies.get(currency)
  if (!format) {
    format = {
      exact: new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }),
      compact: new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency,
        notation: 'compact',
        maximumFractionDigits: 1,
      }),
    }
    currencies.set(currency, format)
  }
  return format
}

export function formatCount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return MISSING
  return Math.abs(value) >= EXACT_LIMIT ? compactCount.format(value) : count.format(value)
}

export function formatCurrency(value: number | null | undefined, currency = 'USD') {
  if (value == null || !Number.isFinite(value)) return MISSING
  const format = currencyFormat(currency)
  return Math.abs(value) >= EXACT_LIMIT ? format.compact.format(value) : format.exact.format(value)
}

export function formatPercent(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? MISSING : percent.format(value)
}

/** A change as a signed share, `+12.4%` or `−8.1%`. */
export function formatDelta(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return MISSING
  return signedPercent.format(value).replace('-', '−')
}

/** Elapsed milliseconds, from `420 ms` through `2.4s`, `2m 14s` and `3h 5m` to `1d 2h`. */
export function formatDuration(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return MISSING
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** Compute Units; an unknown amount stays unknown rather than reading as zero. */
export function formatComputeUnits(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return MISSING
  return Math.abs(value) >= EXACT_LIMIT ? compactCount.format(value) : units.format(value)
}

export function formatUnit(value: number | null | undefined, unit: DashboardUnit) {
  switch (unit.kind) {
    case 'currency':
      return formatCurrency(value, unit.currency)
    case 'percent':
      return formatPercent(value)
    case 'duration':
      return formatDuration(value)
    default:
      return formatCount(value)
  }
}

const tickCount = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 })

function compactTick(value: number) {
  return tickCount.format(value).replace(/K$/, 'k')
}

/** A short axis label for a scale tick. */
export function formatTick(value: number, unit: DashboardUnit) {
  switch (unit.kind) {
    case 'duration':
      if (value === 0) return '0'
      return value >= 60_000 ? `${Math.round(value / 60_000)}m` : `${Math.round(value / 1000)}s`
    case 'percent':
      return `${Math.round(value * 100)}%`
    case 'currency':
      return `${value < 0 ? '−' : ''}${unit.currency === 'USD' ? '$' : ''}${compactTick(Math.abs(value))}`
    default:
      return compactTick(value)
  }
}

/** The smallest 1, 2 or 5 step at or above `value`, so a scale ends on a round tick. */
export function niceMaximum(value: number, unit: DashboardUnit = { kind: 'count' }) {
  if (!Number.isFinite(value) || value <= 0) return 1
  // Durations step in whole minutes or seconds, the units their ticks are written in.
  const step = unit.kind === 'duration' ? (value >= 60_000 ? 60_000 : 1000) : 1
  const scaled = value / step
  const power = 10 ** Math.floor(Math.log10(scaled))
  return ([1, 2, 5, 10].find((size) => size * power >= scaled) ?? 10) * power * step
}
