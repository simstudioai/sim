import { useInfiniteQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { type AuditLogPage, listAuditLogsContract } from '@/lib/api/contracts/audit-logs'

export const auditLogKeys = {
  all: ['audit-logs'] as const,
  lists: () => [...auditLogKeys.all, 'list'] as const,
  list: (organizationId: string, filters: AuditLogFilters) =>
    [...auditLogKeys.lists(), organizationId, filters] as const,
}

export interface AuditLogFilters {
  search?: string
  action?: string
  resourceType?: string
  actorId?: string
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
    staleTime: 30 * 1000,
  })
}
