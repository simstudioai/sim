import { isRecordLike } from '@sim/utils/object'
import { defaultBillingPeriod } from '@/lib/billing/core/billing-period'
import { isEnterprise } from '@/lib/billing/plan-helpers'

export const ENTERPRISE_REPORTING_PERIOD_ANCHOR_METADATA_KEY = 'reportingPeriodAnchorDate'

export type BillingInterval = 'month' | 'year'
export type UsagePeriodSource = 'reporting' | 'stripe' | 'default'

export interface ResolvedUsagePeriod {
  start: Date
  end: Date
  source: UsagePeriodSource
  anchorDate: string | null
  interval: BillingInterval | null
}

export interface ResolvedEnterpriseReportingPeriod extends ResolvedUsagePeriod {
  source: 'reporting'
  anchorDate: string
  interval: BillingInterval
}

interface SubscriptionPeriodInput {
  plan?: string | null
  billingInterval?: string | null
  metadata?: unknown
  periodStart?: Date | null
  periodEnd?: Date | null
  usagePeriod?: ResolvedUsagePeriod | null
}

function parseDateOnly(value: unknown): { value: string; date: Date } | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null
  return { value, date }
}

function parseBillingInterval(value: unknown): BillingInterval | null {
  return value === 'month' || value === 'year' ? value : null
}

function calendarDateAtOffset(anchor: Date, monthOffset: number): Date {
  const targetMonth = anchor.getUTCMonth() + monthOffset
  const targetYear = anchor.getUTCFullYear() + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  return new Date(Date.UTC(targetYear, normalizedMonth, Math.min(anchor.getUTCDate(), lastDay)))
}

export function resolveEnterpriseReportingPeriod(
  anchorDate: string,
  interval: BillingInterval,
  now: Date = new Date()
): ResolvedEnterpriseReportingPeriod | null {
  const parsed = parseDateOnly(anchorDate)
  if (!parsed || parsed.date.getTime() > now.getTime()) return null

  const intervalMonths = interval === 'year' ? 12 : 1
  const elapsedMonths =
    (now.getUTCFullYear() - parsed.date.getUTCFullYear()) * 12 +
    now.getUTCMonth() -
    parsed.date.getUTCMonth()
  let intervalOffset = Math.max(0, Math.floor(elapsedMonths / intervalMonths))
  let start = calendarDateAtOffset(parsed.date, intervalOffset * intervalMonths)
  if (start.getTime() > now.getTime()) {
    intervalOffset = Math.max(0, intervalOffset - 1)
    start = calendarDateAtOffset(parsed.date, intervalOffset * intervalMonths)
  }
  const end = calendarDateAtOffset(parsed.date, (intervalOffset + 1) * intervalMonths)

  return {
    start,
    end,
    source: 'reporting',
    anchorDate: parsed.value,
    interval,
  }
}

export function resolveSubscriptionUsagePeriod(
  subscription: SubscriptionPeriodInput | null | undefined,
  now: Date = new Date()
): ResolvedUsagePeriod | null {
  if (
    subscription?.usagePeriod &&
    subscription.usagePeriod.end.getTime() > subscription.usagePeriod.start.getTime()
  ) {
    return subscription.usagePeriod
  }
  if (subscription && isEnterprise(subscription.plan)) {
    const metadata = isRecordLike(subscription.metadata) ? subscription.metadata : {}
    const anchor = metadata[ENTERPRISE_REPORTING_PERIOD_ANCHOR_METADATA_KEY]
    const interval = parseBillingInterval(subscription.billingInterval)
    if (typeof anchor === 'string' && interval) {
      const reportingPeriod = resolveEnterpriseReportingPeriod(anchor, interval, now)
      if (reportingPeriod) return reportingPeriod
    }
  }

  if (subscription?.periodStart && subscription.periodEnd) {
    return {
      start: subscription.periodStart,
      end: subscription.periodEnd,
      source: 'stripe',
      anchorDate: null,
      interval: parseBillingInterval(subscription.billingInterval),
    }
  }

  return null
}

/** Resolves a paid subscription's canonical usage window, including the open fallback window. */
export function resolveSubscriptionUsagePeriodOrDefault(
  subscription: SubscriptionPeriodInput,
  now: Date = new Date()
): ResolvedUsagePeriod {
  return (
    resolveSubscriptionUsagePeriod(subscription, now) ?? {
      ...defaultBillingPeriod(),
      source: 'default',
      anchorDate: null,
      interval: null,
    }
  )
}
