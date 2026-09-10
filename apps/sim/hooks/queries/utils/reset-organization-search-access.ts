import type { QueryClient } from '@tanstack/react-query'
import { resourceScopeKey } from '@/lib/core/resource-scope'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { searchSourceKeys } from '@/hooks/queries/utils/search-source-keys'

/** Drops cached results and document content when organization Search access changes. */
export async function resetOrganizationSearchAccess(
  queryClient: QueryClient,
  organizationId: string
) {
  const scope = { kind: 'organization', organizationId } as const
  await Promise.all([
    queryClient.resetQueries({
      queryKey: [...knowledgeKeys.searches(), resourceScopeKey(scope)],
    }),
    /** Document keys carry no resource scope and may exist without source or result caches. */
    queryClient.resetQueries({ queryKey: knowledgeKeys.details() }),
    queryClient.resetQueries({ queryKey: searchSourceKeys.list(scope) }),
  ])
}
