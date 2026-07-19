import type { QueryClient } from '@tanstack/react-query'
import type { InterfaceDefinition } from '@/lib/interfaces'
import { prefetchInternalJson } from '@/app/workspace/[workspaceId]/lib/prefetch-internal-fetch'
import { INTERFACE_LIST_STALE_TIME, interfaceKeys } from '@/hooks/queries/utils/interface-keys'

/**
 * Prefetches the workspace's interfaces list under the same query key the
 * client `useInterfacesList` hook uses (scope `active`), so the list paints
 * populated on first render.
 *
 * The list goes through the `/api/interfaces` route rather than the data layer
 * so the cached entry byte-matches the wire shape `requestJson` caches on the
 * client — see {@link prefetchInternalJson}.
 */
export async function prefetchInterfaces(
  queryClient: QueryClient,
  workspaceId: string
): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: interfaceKeys.list(workspaceId, 'active'),
    queryFn: async () => {
      const response = await prefetchInternalJson<{ data: { interfaces: InterfaceDefinition[] } }>(
        `/api/interfaces?workspaceId=${workspaceId}&scope=active`
      )
      return response.data.interfaces
    },
    staleTime: INTERFACE_LIST_STALE_TIME,
  })
}
