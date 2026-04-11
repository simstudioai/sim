import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import type { EnterpriseAuditLogEntry } from '@/app/api/v1/audit-logs/format'

export const auditLogKeys = {
  all: ['audit-logs'] as const,
  lists: () => [...auditLogKeys.all, 'list'] as const,
  list: (filters: AuditLogFilters) => [...auditLogKeys.lists(), filters] as const,
}

export interface AuditLogFilters {
  search?: string
  action?: string
  resourceType?: string
  actorId?: string
  startDate?: string
  endDate?: string
}

interface AuditLogPage {
  success: boolean
  data: EnterpriseAuditLogEntry[]
  nextCursor?: string
}

async function fetchAuditLogs(
  filters: AuditLogFilters,
  cursor?: string,
  signal?: AbortSignal
): Promise<AuditLogPage> {
  const params = new URLSearchParams()
  params.set('limit', '50')
  if (filters.search) params.set('search', filters.search)
  if (filters.action) params.set('action', filters.action)
  if (filters.resourceType) params.set('resourceType', filters.resourceType)
  if (filters.actorId) params.set('actorId', filters.actorId)
  if (filters.startDate) params.set('startDate', filters.startDate)
  if (filters.endDate) params.set('endDate', filters.endDate)
  if (cursor) params.set('cursor', cursor)

  const response = await fetch(`/api/audit-logs?${params.toString()}`, { signal })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `Failed to fetch audit logs: ${response.status}`)
  }
  return response.json()
}

export function useAuditLogs(filters: AuditLogFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: auditLogKeys.list(filters),
    queryFn: ({ pageParam, signal }) => fetchAuditLogs(filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}
