import { formatChartCompactNumber } from '@sim/emcn'
import { formatDuration } from '@sim/utils/formatting'
import {
  ORGANIZATION_USAGE_OVERVIEW_ROW_LIMIT,
  type OrganizationUsageBreakdown,
  type OrganizationUsageCalendar,
  type OrganizationUsageOverview,
} from '@/lib/api/contracts/organization-usage'
import { formatApportionedCreditCost } from '@/lib/billing/credits/conversion'
import {
  ACTIVITY_DIMENSION_OPTIONS,
  ACTIVITY_SORT_OPTIONS,
  USAGE_OVERVIEW_TAB,
  USAGE_SECTION_LABELS,
  USAGE_SOURCE_CATEGORIES,
  USAGE_TAB_EMPTY_COPY,
  USAGE_TAB_LABELS,
  USAGE_TAB_ORDER,
} from '@/ee/organization-usage/constants'
import {
  foldUsageSeries,
  formatUsageDelta,
  truncateBreakdown,
  usageHeatLevel,
} from '@/ee/organization-usage/format'
import { formatCalendarDate } from '@/platform/embedded/lib/time'

export const USAGE_TABS = USAGE_TAB_ORDER.map((tab) => ({
  value: tab,
  label: USAGE_TAB_LABELS[tab],
}))

export const ACTIVITY_DIMENSIONS = ACTIVITY_DIMENSION_OPTIONS
export const ACTIVITY_SORTS = ACTIVITY_SORT_OPTIONS

export const OVERVIEW_TAB = USAGE_OVERVIEW_TAB
export const SECTION_LABELS = USAGE_SECTION_LABELS
export const EMPTY_COPY = USAGE_TAB_EMPTY_COPY

/** A bucket's timestamp is a wall-clock time in the viewer's zone, so its date is already theirs. */
export function dayLabel(timestamp: string): string {
  return formatCalendarDate(timestamp.slice(0, 10))
}

export function formatDurationMs(ms: number | null): string {
  if (ms === null) return '—'
  return ms === 0 ? '0 ms' : (formatDuration(ms, { precision: 2 }) ?? '—')
}

/** A credit overview's headline and layers. A failed refresh draws nothing from its stale data. */
export function toCreditChart(overview: OrganizationUsageOverview | undefined, failed: boolean) {
  const current = failed ? undefined : overview
  const series = current?.series ?? []
  const present = new Map(foldUsageSeries(series).map((layer) => [layer.category.id, layer.values]))
  const used = current?.totals.credits ?? 0
  const previous = current?.previousTotals?.credits ?? 0
  const limit = current?.limitCredits ?? null
  /** Rounded once, so the arrow and the figure never disagree about a sub-percent change. */
  const delta = current && previous > 0 ? Math.round(((used - previous) / previous) * 100) : null
  return {
    loaded: Boolean(current),
    used,
    deltaLabel: delta === null ? null : formatUsageDelta(delta),
    deltaRose: delta !== null && delta > 0,
    limit,
    overLimit: limit !== null && used > limit,
    limitPercent: limit ? Math.round((used / limit) * 100) : 0,
    series: USAGE_SOURCE_CATEGORIES.map((category) => category.label),
    seriesTotals: Object.fromEntries(
      USAGE_SOURCE_CATEGORIES.map((category) => [
        category.label,
        formatChartCompactNumber(
          (present.get(category.id) ?? []).reduce((sum, value) => sum + value, 0)
        ),
      ])
    ),
    bars: series.map((point, index) => ({
      label: dayLabel(point.timestamp),
      values: USAGE_SOURCE_CATEGORIES.map((category) => present.get(category.id)?.[index] ?? 0),
    })),
  }
}

export function topRows(breakdown: OrganizationUsageBreakdown | undefined) {
  return breakdown && truncateBreakdown(breakdown, ORGANIZATION_USAGE_OVERVIEW_ROW_LIMIT)
}

export type UsageCalendarDay = OrganizationUsageCalendar['days'][number]

function formatDayUsage(day: UsageCalendarDay): string {
  return `${formatApportionedCreditCost(day.credits, day.hasCost)} on ${formatCalendarDate(day.date, 'weekday')}`
}

/** The grid for a year of days, weeks across and Monday first. */
export function layoutUsageCalendar(days: readonly UsageCalendarDay[]) {
  const first = days[0]
  const offset = first ? (new Date(`${first.date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0
  const weeks = Math.ceil((offset + days.length) / 7)
  const peak = Math.max(...days.map((day) => day.credits), 1)
  return {
    weeks,
    total: formatYearUsage(days),
    months: days.flatMap((day, index) => {
      if (!day.date.endsWith('-01')) return []
      const column = Math.floor((index + offset) / 7)
      return column > weeks - 3
        ? []
        : [{ date: day.date, column, label: formatCalendarDate(day.date).split(' ')[0] }]
    }),
    cells: days.map((day, index) => ({
      date: day.date,
      column: Math.floor((index + offset) / 7),
      row: (index + offset) % 7,
      level: usageHeatLevel(day.credits, peak, day.hasCost),
      label: formatDayUsage(day),
    })),
  }
}

function formatYearUsage(days: readonly UsageCalendarDay[]): string {
  const total = days.reduce((sum, day) => sum + day.credits, 0)
  return `${formatApportionedCreditCost(
    total,
    days.some((day) => day.hasCost)
  )} in the last 365 days`
}
