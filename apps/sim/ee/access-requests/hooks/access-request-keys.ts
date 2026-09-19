import type {
  AccessRequestScope,
  AccessRequestStatus,
  DiscoverAccessRequestsQuery,
} from '@/lib/api/contracts/access-requests'

export const ACCESS_REQUESTS_STALE_TIME = 15_000

export const accessRequestKeys = {
  all: ['accessRequests'] as const,
  lists: () => [...accessRequestKeys.all, 'list'] as const,
  mine: (scope: AccessRequestScope, offset: number, requestId?: string) =>
    [...accessRequestKeys.lists(), 'mine', scope, offset, requestId ?? ''] as const,
  organization: (
    organizationId: string,
    offset: number,
    status: AccessRequestStatus | 'all',
    search = ''
  ) =>
    [...accessRequestKeys.lists(), 'organization', organizationId, offset, status, search] as const,
  discoveries: () => [...accessRequestKeys.all, 'discovery'] as const,
  discovery: (query: DiscoverAccessRequestsQuery) =>
    [...accessRequestKeys.discoveries(), query] as const,
  details: () => [...accessRequestKeys.all, 'detail'] as const,
  organizationDetails: (organizationId: string) =>
    [...accessRequestKeys.details(), organizationId] as const,
  preview: (organizationId: string, requestId: string) =>
    [...accessRequestKeys.organizationDetails(organizationId), requestId] as const,
  settings: (organizationId: string) =>
    [...accessRequestKeys.all, 'settings', organizationId] as const,
}

export function workspaceFeatureDiscoveryQuery(workspaceId: string) {
  return {
    kind: 'workspace',
    workspaceId,
    targetKind: 'feature',
    limit: 100,
    offset: 0,
  } as const satisfies DiscoverAccessRequestsQuery
}
