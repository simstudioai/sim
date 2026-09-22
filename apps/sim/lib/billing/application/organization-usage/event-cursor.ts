import type { CursorKey } from '@/lib/api/list-query'
import { requireBoundedUsageWindow } from '@/lib/billing/application/organization-usage/limits'
import { type UsageAnalyticsWindow, usageWindowBounds } from '@/lib/billing/core/usage-analytics'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Preserve the first page's ledger predicate across clock and subscription changes. */
export function readUsageEventCursor(keys: CursorKey[], maxWindowDays?: number) {
  const [kind, start, end, ...cursorKeys] = keys
  if (
    keys.length !== 5 ||
    (kind !== 'period' && kind !== 'range') ||
    typeof start !== 'string' ||
    typeof end !== 'string'
  ) {
    throw new OrchestrationError('validation', 'Invalid usage event cursor; restart pagination')
  }
  const from = new Date(start)
  const to = new Date(end)
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
    throw new OrchestrationError(
      'validation',
      'Invalid usage event cursor window; restart pagination'
    )
  }
  const window: UsageAnalyticsWindow =
    kind === 'range'
      ? { kind, from, to }
      : {
          kind,
          period: { start: from, end: to, source: 'stripe', anchorDate: null, interval: null },
        }
  requireBoundedUsageWindow(window, maxWindowDays)
  return { window, cursorKeys }
}

export function writeUsageEventCursor(
  window: UsageAnalyticsWindow,
  keys: CursorKey[] | null
): CursorKey[] | null {
  if (!keys) return null
  const { start, end } = usageWindowBounds(window)
  const kind = window.kind === 'period' && window.period.source !== 'reporting' ? 'period' : 'range'
  return [kind, start.toISOString(), end.toISOString(), ...keys]
}
