/**
 * React Query key factory for the credit usage log.
 *
 * Lives in this standalone (non-`'use client'`) module — like
 * {@link file://./table-keys.ts} — so it can be imported from server
 * components without pulling in the `'use client'`
 * `@/hooks/queries/usage-logs` module, whose exports would otherwise
 * resolve to client-reference stubs on the server.
 */

import type { UsageLogPeriod, UsageLogSource } from '@/lib/api/contracts/user'

export interface UsageLogDateRange {
  startDate?: string
  endDate?: string
}

export const usageLogKeys = {
  all: ['usage-logs'] as const,
  lists: () => [...usageLogKeys.all, 'list'] as const,
  list: (period: UsageLogPeriod, source?: UsageLogSource, dateRange?: UsageLogDateRange) =>
    [
      ...usageLogKeys.lists(),
      period,
      source ?? '',
      dateRange?.startDate ?? '',
      dateRange?.endDate ?? '',
    ] as const,
  summaries: () => [...usageLogKeys.all, 'summary'] as const,
  summary: (period: UsageLogPeriod) => [...usageLogKeys.summaries(), period] as const,
}
