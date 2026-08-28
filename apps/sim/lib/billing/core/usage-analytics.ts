import { usageLog } from '@sim/db/schema'
import { eq, gte, lt, type SQL } from 'drizzle-orm'
import { MAX_CUSTOM_RANGE_DAYS } from '@/lib/api/contracts/organization-usage'
import {
  type ResolvedUsagePeriod,
  resolveEnterpriseReportingPeriod,
} from '@/lib/billing/core/reporting-period'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import { zonedWallClockToUtc } from '@/lib/core/utils/timezone'

/**
 * Pure half of organization usage analytics: window resolution, the ledger scope
 * every query is built from, bucket granularity, and the folds that turn sparse
 * rows into dense series and ranked lists.
 *
 * No DB access, so the parts most likely to be wrong — period semantics and
 * reconciliation arithmetic — are directly testable.
 */

export const USAGE_WINDOW_PRESETS = [
  'current-period',
  'previous-period',
  '7d',
  '30d',
  'custom',
] as const
export type UsageWindowPreset = (typeof USAGE_WINDOW_PRESETS)[number]

export const USAGE_BREAKDOWN_DIMENSIONS = [
  'member',
  'workspace',
  'workflow',
  'model',
  'byok',
  'source',
] as const
export type UsageBreakdownDimension = (typeof USAGE_BREAKDOWN_DIMENSIONS)[number]

export type UsageBucket = 'day' | 'week' | 'month'

/**
 * A custom range is capped because three of the five breakdown dimensions are not
 * index-covered and heap-fetch per row; an unbounded range over a large ledger is a
 * table scan. Longer look-back goes through `previous-period`, which is stamped.
 *
 * Declared on the contract so the picker and this resolver state one number.
 */
export { MAX_CUSTOM_RANGE_DAYS }

const DAY_MS = 24 * 60 * 60 * 1000

export type UsageAnalyticsWindow =
  | { kind: 'period'; period: ResolvedUsagePeriod }
  | { kind: 'range'; from: Date; to: Date }

/**
 * The ledger predicate every usage query is built from.
 *
 * This is the one place the `reporting` branch is written for this feature, and it
 * mirrors `getBillingPeriodUsageCost` deliberately: a reporting period is derived
 * from an anchor date and is *not* what rows are stamped with, so it matches on
 * `created_at`; a stripe/default period matches the stamps exactly. Diverging here
 * is how the usage panel would come to disagree with the billing page about the
 * same period.
 */
export function buildUsageAnalyticsScope(
  entity: BillingEntity,
  window: UsageAnalyticsWindow
): SQL[] {
  const conditions: SQL[] = [
    eq(usageLog.billingEntityType, entity.type),
    eq(usageLog.billingEntityId, entity.id),
  ]

  if (window.kind === 'range') {
    conditions.push(gte(usageLog.createdAt, window.from), lt(usageLog.createdAt, window.to))
    return conditions
  }

  if (window.period.source === 'reporting') {
    conditions.push(
      gte(usageLog.createdAt, window.period.start),
      lt(usageLog.createdAt, window.period.end)
    )
    return conditions
  }

  conditions.push(
    eq(usageLog.billingPeriodStart, window.period.start),
    eq(usageLog.billingPeriodEnd, window.period.end)
  )
  return conditions
}

/** The instants a window covers, for labelling and for deriving bucket granularity. */
export function usageWindowBounds(window: UsageAnalyticsWindow): { start: Date; end: Date } {
  return window.kind === 'range'
    ? { start: window.from, end: window.to }
    : { start: window.period.start, end: window.period.end }
}

export class UsageWindowRangeTooLargeError extends Error {
  constructor(days: number) {
    super(`Custom range spans ${days} days; the maximum is ${MAX_CUSTOM_RANGE_DAYS}.`)
    this.name = 'UsageWindowRangeTooLargeError'
  }
}

export class UsageWindowRangeInvertedError extends Error {
  constructor() {
    super('Custom range ends before it starts.')
    this.name = 'UsageWindowRangeInvertedError'
  }
}

/**
 * How much of an unbounded period to show.
 *
 * A deployment with no subscription resolves to `defaultBillingPeriod()`, which is
 * the open pair `1970-01-01 … 9999-12-31`. Rendered as a period that is 1,000
 * monthly buckets ending in 2053, stopped only by the densifier's loop guard — the
 * chart was unusable and the label claimed it was a billing period. Self-hosted is
 * exactly where this is reachable, since `USAGE_MONITORING_ENABLED` opens the panel
 * on deployments that have no subscription at all.
 */
const UNBOUNDED_PERIOD_DISPLAY_DAYS = 30

/** True for the open sentinel period a deployment without a subscription resolves to. */
function isUnboundedPeriod(period: ResolvedUsagePeriod): boolean {
  return period.source === 'default'
}

interface ResolveUsageWindowArgs {
  preset: UsageWindowPreset
  /** The payer's current period, already resolved from its subscription. */
  period: ResolvedUsagePeriod
  customStart?: Date
  customEnd?: Date
  /**
   * The viewer's calendar, used to resolve date-only custom bounds. The picker
   * offers calendar days, so "Aug 31" has to mean midnight-to-midnight *there*.
   */
  timezone?: string
  now?: Date
}

/** The civil date an already-UTC-parsed `YYYY-MM-DD` bound represents. */
function civilBoundKey(bound: Date): string {
  return bound.toISOString().slice(0, 10)
}

/** Exact whole-day distance between two civil dates; unaffected by DST. */
function civilDaysBetween(fromKey: string, toKey: string): number {
  return Math.round((civilDate(toKey).getTime() - civilDate(fromKey).getTime()) / DAY_MS)
}

/**
 * Maps a picker selection to a window the ledger can actually match.
 *
 * `current-period` and `previous-period` stay *periods* so they use the same
 * predicate the billing page does; the rolling and custom presets are plain
 * `created_at` ranges.
 */
export function resolveUsageAnalyticsWindow({
  preset,
  period,
  customStart,
  customEnd,
  timezone = 'UTC',
  now = new Date(),
}: ResolveUsageWindowArgs): UsageAnalyticsWindow {
  switch (preset) {
    case 'current-period':
      return isUnboundedPeriod(period)
        ? {
            kind: 'range',
            from: new Date(now.getTime() - UNBOUNDED_PERIOD_DISPLAY_DAYS * DAY_MS),
            to: now,
          }
        : { kind: 'period', period }
    case 'previous-period': {
      const previous = resolvePreviousPeriod(period)
      if (previous) return { kind: 'period', period: previous }
      // An open period has no meaningful predecessor — deriving one from its length
      // reaches back eight millennia — so it steps back by the display window instead.
      if (isUnboundedPeriod(period)) {
        const to = new Date(now.getTime() - UNBOUNDED_PERIOD_DISPLAY_DAYS * DAY_MS)
        return {
          kind: 'range',
          from: new Date(to.getTime() - UNBOUNDED_PERIOD_DISPLAY_DAYS * DAY_MS),
          to,
        }
      }
      // A stripe period carries no rule for deriving its predecessor, so fall back to
      // a range of the same length rather than inventing stamps that would match
      // nothing. This is an approximation, which is why it is never used as the
      // summary's comparison window — see `resolvePreviousPeriod` there.
      return {
        kind: 'range',
        from: new Date(period.start.getTime() - (period.end.getTime() - period.start.getTime())),
        to: period.start,
      }
    }
    case '7d':
      return { kind: 'range', from: new Date(now.getTime() - 7 * DAY_MS), to: now }
    case '30d':
      return { kind: 'range', from: new Date(now.getTime() - 30 * DAY_MS), to: now }
    case 'custom': {
      if (!customStart || !customEnd) return { kind: 'period', period }
      /**
       * The picker offers calendar days and sends `YYYY-MM-DD`, which arrives here
       * parsed as UTC midnight. Anchoring the window on those instants shifted every
       * non-UTC viewer's selection by their offset — a range labelled "Aug 1–31"
       * covered half of Jul 31 and half of Aug 31 for a viewer twelve hours east,
       * and disagreed with the chart, whose buckets are already the viewer's
       * calendar days. Reinterpret the same civil dates as midnight *there*.
       */
      const startKey = civilBoundKey(customStart)
      const endKey = civilBoundKey(customEnd)
      // Guarded before the span check, which would otherwise measure a negative
      // number of days, pass the cap, and return an inverted range that matches no
      // rows — reading as "no usage" rather than as a bad request.
      if (endKey < startKey) throw new UsageWindowRangeInvertedError()

      const days = civilDaysBetween(startKey, endKey) + 1
      if (days > MAX_CUSTOM_RANGE_DAYS) throw new UsageWindowRangeTooLargeError(days)

      const exclusiveEndKey = civilKey(
        (() => {
          const cursor = civilDate(endKey)
          cursor.setUTCDate(cursor.getUTCDate() + 1)
          return cursor
        })()
      )
      return {
        kind: 'range',
        from: zonedWallClockToUtc(`${startKey}T00:00`, timezone),
        to: zonedWallClockToUtc(`${exclusiveEndKey}T00:00`, timezone),
      }
    }
  }
}

/**
 * The period immediately before this one, or `null` when it is not exactly
 * derivable. Only a reporting period has a rule (its anchor); a stripe period's
 * predecessor lives in Stripe, and guessing it would silently compare against the
 * wrong window.
 */
export function resolvePreviousPeriod(period: ResolvedUsagePeriod): ResolvedUsagePeriod | null {
  if (period.source !== 'reporting' || !period.anchorDate || !period.interval) return null
  return resolveEnterpriseReportingPeriod(
    period.anchorDate,
    period.interval,
    new Date(period.start.getTime() - 1)
  )
}

/**
 * Bucket width derived from the window rather than requested.
 *
 * Calendar-aligned on purpose: a billing period starts at an arbitrary instant, so
 * epoch-modulo buckets would cut every day mid-afternoon and each bar would straddle
 * two calendar days. Spend is read against the calendar.
 */
export function resolveUsageBucket(window: UsageAnalyticsWindow): UsageBucket {
  const { start, end } = usageWindowBounds(window)
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS))
  if (days <= 92) return 'day'
  if (days <= 400) return 'week'
  return 'month'
}

export interface UsageSeriesPoint {
  timestamp: string
  cost: number
  events: number
}

interface SparseBucketRow {
  bucketStart: string | null
  cost: string | number | null
  events: number | string | null
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number.parseFloat(value ?? '0')
  return Number.isFinite(parsed) ? parsed : 0
}

/** The `YYYY-MM-DD` an instant falls on in the viewer's calendar — what `AT TIME ZONE` produced. */
function localCalendarDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/**
 * Civil-date arithmetic on a `YYYY-MM-DD` key.
 *
 * UTC is used purely as a proleptic calendar here — these values are never converted
 * back to an instant, so no offset or DST transition can shift them. Doing the same
 * arithmetic on a real local instant is what would break across a DST boundary.
 */
function civilDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`)
}

function civilKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Mirrors Postgres `date_trunc(bucket, …)`: an ISO week starts Monday, a month on
 * the 1st. The series keys have to land on the same boundaries the SQL emitted or
 * no lookup below will ever hit.
 */
function truncateToBucket(key: string, bucket: UsageBucket): string {
  const date = civilDate(key)
  if (bucket === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  else if (bucket === 'month') date.setUTCDate(1)
  return civilKey(date)
}

/**
 * Fills every bucket in the window, because SQL only returns buckets that have rows.
 *
 * A period with no usage must render a flat zero line, not the chart's "No data"
 * branch — zero is information, "No data" reads as a failure.
 *
 * The keys are generated in the *same calendar the query grouped by*:
 * `readUsageTimeSeries` truncates `created_at AT TIME ZONE <timezone>`, so a viewer
 * east or west of UTC buckets rows by their own calendar date. Walking UTC dates
 * here instead dropped the edge buckets of every non-UTC window — their cost stayed
 * in the headline while their bar read zero. Week and month were worse than an edge
 * case: Postgres aligns those to Monday and the 1st, so a cursor stepping from an
 * arbitrary period start shared no key with the query at all and the whole chart
 * came back zeroed. That is reachable today through an annual enterprise period,
 * which resolves to `week`.
 */
export function densifyUsageSeries(
  rows: SparseBucketRow[],
  window: UsageAnalyticsWindow,
  bucket: UsageBucket,
  timezone: string
): UsageSeriesPoint[] {
  const byBucket = new Map<string, SparseBucketRow>()
  for (const row of rows) {
    if (row.bucketStart) byBucket.set(row.bucketStart.slice(0, 10), row)
  }

  const { start, end } = usageWindowBounds(window)
  const first = truncateToBucket(localCalendarDate(start, timezone), bucket)
  // The window is half-open, so the last bucket is the one holding its final instant.
  const last = truncateToBucket(localCalendarDate(new Date(end.getTime() - 1), timezone), bucket)

  const points: UsageSeriesPoint[] = []
  const cursor = civilDate(first)
  let guard = 0

  // `YYYY-MM-DD` sorts lexicographically in calendar order, so this compares dates.
  while (civilKey(cursor) <= last && guard < 1000) {
    guard += 1
    const key = civilKey(cursor)
    const row = byBucket.get(key)
    points.push({
      timestamp: `${key}T00:00:00`,
      cost: toNumber(row?.cost),
      events: Math.round(toNumber(row?.events)),
    })
    if (bucket === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1)
    else if (bucket === 'week') cursor.setUTCDate(cursor.getUTCDate() + 7)
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }

  return points
}

export interface UsageBreakdownEntry {
  id: string
  label: string
  cost: number
  events: number
  /** Share of the window total, 0..1 — of everything, not just the visible rows. */
  share: number
}

export interface UsageBreakdownFold {
  rows: UsageBreakdownEntry[]
  /** `tokens` is the omitted rows' total, so a token-denominated tab still adds up. */
  other: { cost: number; events: number; rowCount: number; tokens: number }
  totalCost: number
}

interface RankedRow {
  key: string | null
  cost: string | number | null
  events: number | string | null
  inputTokens?: number
  outputTokens?: number
}

/**
 * Ranks a dimension and closes it with an explicit remainder.
 *
 * The remainder is not cosmetic: five lists that do not add up to the headline
 * number is the classic "the numbers are wrong" bug, and the only way a truncated
 * ranking can reconcile is by naming what it left out.
 *
 * `rankBy` exists because BYOK has no cost to rank by — every row is zero by
 * definition, so a cost sort fell through to its alphabetical tiebreak and the
 * "top providers" were whichever ones sorted first. A tab denominated in tokens
 * has to rank by tokens.
 */
export function foldUsageBreakdown(
  rows: RankedRow[],
  totalCost: number,
  labelFor: (key: string | null) => string,
  limit: number,
  rankBy: 'cost' | 'tokens' = 'cost'
): UsageBreakdownFold {
  const ranked = rows
    .map((row) => ({
      id: row.key ?? '',
      label: labelFor(row.key),
      cost: toNumber(row.cost),
      events: Math.round(toNumber(row.events)),
      tokens: (row.inputTokens ?? 0) + (row.outputTokens ?? 0),
    }))
    .sort(
      (left, right) =>
        (rankBy === 'tokens' ? right.tokens - left.tokens : right.cost - left.cost) ||
        left.label.localeCompare(right.label)
    )

  const visible = ranked.slice(0, limit)
  const hidden = ranked.slice(limit)
  const share = (cost: number) => (totalCost > 0 ? cost / totalCost : 0)

  return {
    rows: visible.map(({ tokens: _tokens, ...row }) => ({ ...row, share: share(row.cost) })),
    other: {
      cost: hidden.reduce((sum, row) => sum + row.cost, 0),
      events: hidden.reduce((sum, row) => sum + row.events, 0),
      rowCount: hidden.length,
      // BYOK ranks by cost, which is zero for every row, so the visible slice is
      // effectively arbitrary — omitting the tail's tokens would hide real volume.
      tokens: hidden.reduce((sum, row) => sum + row.tokens, 0),
    },
    totalCost,
  }
}

/**
 * What a null grouping key means, per dimension.
 *
 * A single "Unattributed" label was wrong in both directions: on Workspaces it means
 * usage that belongs to no workspace, and on Workflows it means usage that never came
 * from a workflow — which is most of an organization's spend, and reading that as an
 * attribution failure is what made the workflow list useless.
 */
export const USAGE_NULL_KEY_LABELS: Record<UsageBreakdownDimension, string> = {
  member: 'Unknown member',
  workspace: 'No workspace',
  // Unreachable: the workflow dimension filters null ids out entirely.
  workflow: 'Unknown workflow',
  model: 'Unknown model',
  byok: 'Unknown provider',
  source: 'Other',
}

export interface MergeableRow {
  key: string | null
  cost: string | number | null
  events: number | string | null
  inputTokens?: number
  outputTokens?: number
}

/**
 * Re-keys rows onto a coarser identity and sums the collisions.
 *
 * Needed wherever the SQL grouping column is finer than what the panel shows. The
 * ledger stores `copilot` and `workspace-chat` as distinct sources but both display
 * as "Sim Chat", so grouping by the raw column alone renders the same label twice
 * with the usage split across the two rows — which reads as a bug and makes the
 * ranking wrong. Models collapse to a provider the same way.
 */
export function mergeRowsByKey<T extends MergeableRow>(
  rows: T[],
  resolveKey: (key: string | null) => string | null
): MergeableRow[] {
  const merged = new Map<string, MergeableRow>()
  for (const row of rows) {
    const key = resolveKey(row.key)
    const mapKey = key ?? ''
    const existing = merged.get(mapKey)
    if (!existing) {
      merged.set(mapKey, {
        key,
        cost: toNumber(row.cost),
        events: Math.round(toNumber(row.events)),
        ...(row.inputTokens !== undefined ? { inputTokens: row.inputTokens } : {}),
        ...(row.outputTokens !== undefined ? { outputTokens: row.outputTokens } : {}),
      })
      continue
    }
    existing.cost = toNumber(existing.cost) + toNumber(row.cost)
    existing.events = Math.round(toNumber(existing.events) + toNumber(row.events))
    if (row.inputTokens !== undefined) {
      existing.inputTokens = (existing.inputTokens ?? 0) + row.inputTokens
    }
    if (row.outputTokens !== undefined) {
      existing.outputTokens = (existing.outputTokens ?? 0) + row.outputTokens
    }
  }
  return [...merged.values()]
}
