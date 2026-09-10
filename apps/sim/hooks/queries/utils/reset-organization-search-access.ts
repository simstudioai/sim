import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { SearchSourcePage } from '@/lib/api/contracts/knowledge/connectors'
import type { WorkspaceKnowledgeSearchResult } from '@/lib/api/contracts/knowledge/search'
import { resourceScopeKey } from '@/lib/core/resource-scope'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { searchSourceKeys } from '@/hooks/queries/utils/search-source-keys'

/** Drops cached results and document content when organization Search access changes. */
export async function resetOrganizationSearchAccess(
  queryClient: QueryClient,
  organizationId: string
) {
  const scope = { kind: 'organization', organizationId } as const
  const pages = queryClient.getQueriesData<InfiniteData<SearchSourcePage>>({
    queryKey: searchSourceKeys.list(scope),
    predicate: (query) => query.queryKey[3] === 'pages',
  })
  const searchKey = [...knowledgeKeys.searches(), resourceScopeKey(scope)]
  const results = queryClient.getQueriesData<WorkspaceKnowledgeSearchResult[]>({
    queryKey: searchKey,
  })
  const knowledgeBaseIds = new Set([
    ...pages.flatMap(
      ([, data]) =>
        data?.pages.flatMap((page) => page.sources.map((source) => source.knowledgeBaseId)) ?? []
    ),
    ...results.flatMap(([, data]) => data?.map((result) => result.knowledgeBaseId) ?? []),
  ])
  await Promise.all([
    queryClient.resetQueries({
      queryKey: searchKey,
    }),
    ...[...knowledgeBaseIds].map((id) =>
      queryClient.resetQueries({ queryKey: knowledgeKeys.detail(id) })
    ),
    queryClient.resetQueries({ queryKey: searchSourceKeys.list(scope) }),
  ])
}
