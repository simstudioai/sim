import { type UsageAnalyticsWindow, usageWindowBounds } from '@/lib/billing/core/usage-analytics'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export const PUBLIC_ORGANIZATION_USAGE_MAX_WINDOW_DAYS = 366
export const PUBLIC_ORGANIZATION_USAGE_MAX_GROUPED_ROWS = 10_000

/** Public callers must choose a finite reporting window, including when no billing period exists. */
export function requireBoundedUsageWindow(window: UsageAnalyticsWindow, maxDays?: number) {
  if (maxDays === undefined) return
  const { start, end } = usageWindowBounds(window)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new OrchestrationError(
      'validation',
      'Usage window must have a finite start before its end'
    )
  }
  if (end.getTime() - start.getTime() > maxDays * 86_400_000) {
    throw new OrchestrationError(
      'validation',
      `Usage windows cannot exceed ${maxDays} days; choose 7d, 30d, or a bounded custom range`
    )
  }
}

export class UsageBreakdownTooLargeError extends OrchestrationError {
  constructor() {
    super(
      'payload_too_large',
      'Usage breakdown has too many groups; choose a narrower time window or workspace'
    )
  }
}
