/**
 * React Query key factory for the credit usage log.
 *
 * Lives in this standalone (non-`'use client'`) module — like
 * {@link file://./table-keys.ts} — so it can be imported from server
 * components without pulling in the `'use client'`
 * `@/hooks/queries/usage-logs` module, whose exports would otherwise
 * resolve to client-reference stubs on the server.
 */

import type { UsageLogSource } from '@/lib/api/contracts/user'

export const usageLogKeys = {
  all: ['usage-logs'] as const,
  lists: () => [...usageLogKeys.all, 'list'] as const,
  list: (period: string, source?: UsageLogSource) =>
    [...usageLogKeys.lists(), period, source ?? ''] as const,
}
