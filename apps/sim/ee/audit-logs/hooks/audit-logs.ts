import { hashKey, useInfiniteQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { type AuditLogPage, listAuditLogsContract } from '@/lib/api/contracts/audit-logs'

export const AUDIT_LOG_LIST_STALE_TIME = 30 * 1000

export const auditLogKeys = {
  all: ['audit-logs'] as const,
  lists: () => [...auditLogKeys.all, 'list'] as const,
  /**
   * What a key is allowed to see: the organization, and the workspace within it.
   *
   * It leads the key, ahead of the filters, because previous data may be held across
   * a filter change but never across a scope change — and a leading scope makes that
   * a prefix comparison rather than a reach inside the filter object.
   */
  scope: (organizationId: string, workspaceId?: string) =>
    [...auditLogKeys.lists(), organizationId, workspaceId ?? ''] as const,
  list: (organizationId: string, filters: AuditLogFilters) =>
    [...auditLogKeys.scope(organizationId, filters.workspaceId), filters] as const,
}

/** The scope a key reads from, which is everything but its trailing filter object. */
function auditListScopeIdentity(key: readonly unknown[]): string {
  return hashKey(key.slice(0, -1))
}

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
  const queryKey = auditLogKeys.list(organizationId, filters)
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => fetchAuditLogs(organizationId, filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(organizationId) && enabled,
    staleTime: AUDIT_LOG_LIST_STALE_TIME,
    /**
     * Held across a filter change, never across a scope change.
     *
     * Search, types and the window are all part of the key, so without a placeholder
     * the feed blanks to its empty state on each keystroke and the Export action's
     * `isPlaceholderData` guard is dead. But the organization and the workspace are in
     * the key too, and holding across either shows rows the current scope does not
     * cover — one tenant's entries under another's heading, or the organization's
     * under a workspace-scoped URL — with Export armed against them.
     */
    placeholderData: (previous, previousQuery) =>
      previous &&
      previousQuery &&
      auditListScopeIdentity(previousQuery.queryKey) === auditListScopeIdentity(queryKey)
        ? previous
        : undefined,
  })
}
