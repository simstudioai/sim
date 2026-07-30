import type { UsageLogPeriod } from '@/lib/api/contracts/user'

const PERIOD_TO_DAYS: Record<'1d' | '7d' | '30d', number> = { '1d': 1, '7d': 7, '30d': 30 }

interface ResolvedDateRange {
  startDate: Date | undefined
  endDate: Date
}

/** Shared by the list and export routes so their date-filtering can never drift. */
export function resolveDateRange(
  period: UsageLogPeriod,
  customStartDate: string | undefined,
  customEndDate: string | undefined
): ResolvedDateRange {
  if (period === 'custom') {
    if (!customStartDate) throw new Error('startDate is required when period is "custom"')
    return {
      startDate: new Date(customStartDate),
      endDate: customEndDate ? new Date(customEndDate) : new Date(),
    }
  }
  if (period === 'all') return { startDate: undefined, endDate: new Date() }

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - PERIOD_TO_DAYS[period])
  return { startDate, endDate: new Date() }
}
