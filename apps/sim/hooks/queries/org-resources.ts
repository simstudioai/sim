import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getOrgResourcesContract,
  type OrgResourcesCatalogApi,
} from '@/lib/api/contracts/api-reference'

export const ORG_RESOURCES_STALE_TIME = 60 * 1000

/** Hierarchical query keys for the org API catalog. */
export const orgResourceKeys = {
  all: ['org-resources'] as const,
  catalogs: () => [...orgResourceKeys.all, 'catalog'] as const,
  catalog: (organizationId?: string) =>
    [...orgResourceKeys.catalogs(), organizationId ?? ''] as const,
}

async function fetchOrgResources(
  organizationId: string,
  signal?: AbortSignal
): Promise<OrgResourcesCatalogApi> {
  return requestJson(getOrgResourcesContract, {
    params: { id: organizationId },
    signal,
  })
}

/**
 * The org API catalog for the given organization - every published resource the viewer
 * may read, grouped by service (workspace). Disabled until an org id is known.
 */
export function useOrgResources(organizationId?: string | null) {
  return useQuery({
    queryKey: orgResourceKeys.catalog(organizationId ?? undefined),
    queryFn: ({ signal }) => fetchOrgResources(organizationId as string, signal),
    enabled: Boolean(organizationId),
    staleTime: ORG_RESOURCES_STALE_TIME,
  })
}
