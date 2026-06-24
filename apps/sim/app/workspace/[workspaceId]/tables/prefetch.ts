import type { QueryClient } from '@tanstack/react-query'
import type { TableDefinition } from '@/lib/table'
import { prefetchInternalJson } from '@/app/workspace/[workspaceId]/lib/prefetch-internal-fetch'
import { tableKeys } from '@/hooks/queries/tables'

/**
 * Prefetches the workspace's tables list under the same query key the client
 * `useTablesList` hook uses (scope `active`), so the list paints populated on
 * first render.
 *
 * Table definitions carry `Date` fields, so the list goes through the
 * `/api/table` route and caches the serialized wire shape — see
 * {@link prefetchInternalJson}.
 */
export async function prefetchTables(queryClient: QueryClient, workspaceId: string): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: tableKeys.list(workspaceId, 'active'),
    queryFn: async () => {
      const response = await prefetchInternalJson<{ data: { tables: TableDefinition[] } }>(
        `/api/table?workspaceId=${workspaceId}&scope=active`
      )
      return response.data.tables
    },
    staleTime: 30 * 1000,
  })
}
