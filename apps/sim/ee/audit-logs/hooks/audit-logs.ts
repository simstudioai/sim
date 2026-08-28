import { useInfiniteQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { type AuditLogPage, listAuditLogsContract } from '@/lib/api/contracts/audit-logs'

export const AUDIT_LOG_LIST_STALE_TIME = 30 * 1000

export const auditLogKeys = {
  all: ['audit-logs'] as const,
  lists: () => [...auditLogKeys.all, 'list'] as const,
  list: (organizationId: string, filters: AuditLogFilters) =>
    [...auditLogKeys.lists(), organizationId, filters] as const,
}

/**
 * Position of the organization id in a key built by {@link auditLogKeys.list} —
 * derived from the factory rather than restated, so a new prefix segment cannot
 * silently point this at the wrong element.
 */
const AUDIT_LOG_KEY_ORGANIZATION_INDEX = auditLogKeys.lists().length

export interface AuditLogFilters {
  search?: string
  action?: string
  resourceType?: string
  actorId?: string
  /** Narrows the feed to one workspace in the organization. */
  workspaceId?: string
  startDate?: string
  endDate?: string
}

async function fetchAuditLogs(
  organizationId: string,
  filters: AuditLogFilters,
  cursor?: string,
  signal?: AbortSignal
): Promise<AuditLogPage> {
  return requestJson(listAuditLogsContract, {
    query: {
      organizationId,
      limit: '50',
      search: filters.search,
      action: filters.action,
      resourceType: filters.resourceType,
      actorId: filters.actorId,
      workspaceId: filters.workspaceId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      cursor,
    },
    signal,
  })
}

export function useAuditLogs(organizationId: string, filters: AuditLogFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: auditLogKeys.list(organizationId, filters),
    queryFn: ({ pageParam, signal }) => fetchAuditLogs(organizationId, filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(organizationId) && enabled,
    staleTime: AUDIT_LOG_LIST_STALE_TIME,
    /**
     * Held across a filter change, never across an organization change.
     *
     * Every filter — search, types, window, workspace — is part of the key, so
     * without a placeholder the feed blanks to its empty state on each keystroke, and
     * the Export action's `isPlaceholderData` guard was dead. But the organization is
     * in the key too, and `keepPreviousData` alone would paint one tenant's audit
     * entries under another tenant's heading while the new page loaded.
     */
    placeholderData: (previous, previousQuery) =>
      previous && previousQuery?.queryKey[AUDIT_LOG_KEY_ORGANIZATION_INDEX] === organizationId
        ? previous
        : undefined,
  })
}
