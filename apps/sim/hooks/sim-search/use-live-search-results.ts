import { useState } from 'react'
import { useQueryStates } from 'nuqs'
import { groupResultsByDocument, type SearchResultsProps } from '@/lib/knowledge/search/results'
import {
  resourceUrlKeys,
  searchFilterParsers,
  searchFiltersFromParams,
} from '@/lib/mothership/chat/search-params'
import type { SourceTagData } from '@/lib/mothership/chat/special-tags'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useWorkspaceKnowledgeSearch } from '@/hooks/queries/kb/knowledge'

const UNAVAILABLE_ACCOUNT_STATUSES = ['unavailable', 'timeout', 'rate_limited', 'reconnect']

/**
 * What a live search shows and when. Mount it under a key from `liveSearchResultsKey`: the rolling
 * date anchor and the revealed filters belong to one query in one access scope.
 */
export function useLiveSearchResults({
  scope,
  query,
  suppliedFilters,
  topK,
  nativeQueries,
  reuseFreshResult,
  onSummarize,
}: SearchResultsProps) {
  const [hasShownFilters, setHasShownFilters] = useState(false)
  const [searchedAt] = useState(() => Date.now())
  const [params] = useQueryStates(searchFilterParsers, resourceUrlKeys)
  const filters = suppliedFilters ?? searchFiltersFromParams(params, searchedAt)
  const awaitingRange =
    !suppliedFilters && params.updated === 'custom' && !(params.from && params.to)
  const { data, isPending, isFetching, isError, refetch } = useWorkspaceKnowledgeSearch(
    scope,
    awaitingRange ? '' : query,
    filters,
    topK ?? 20,
    { nativeQueries, reuseFreshResult }
  )
  const showFilters = hasShownFilters || data !== undefined || awaitingRange || isError
  if (showFilters && !hasShownFilters) setHasShownFilters(true)
  const documents = groupResultsByDocument(data?.results ?? [])
  const accounts = data?.live?.accounts ?? []
  return {
    awaitingRange,
    isPending,
    isFetching,
    isError,
    refetch,
    documents,
    showFilterControls: !suppliedFilters && showFilters,
    sourceTypes: [
      ...new Set([
        ...accounts.map((account) => account.provider),
        ...(filters.source ? [filters.source] : []),
      ]),
    ],
    noResults:
      !awaitingRange &&
      !isPending &&
      !isFetching &&
      !isError &&
      data?.retrieval.status === 'complete' &&
      documents.length === 0,
    connectAppsHref:
      !isFetching && data?.live && accounts.length === 0
        ? scope.kind === 'organization'
          ? organizationRoutes(scope.organizationId).integrations
          : `/workspace/${scope.workspaceId}/integrations`
        : null,
    someAppsUnavailable: accounts.some((account) =>
      UNAVAILABLE_ACCOUNT_STATUSES.includes(account.status)
    ),
    coverageIncomplete: !data?.live && data?.retrieval.status === 'partial',
    /** Summarize's hand-off for one document: scoped to it, and absent while results may change. */
    summarizerFor: (documentId: string) =>
      isFetching || !onSummarize
        ? undefined
        : (cited: SourceTagData) =>
            onSummarize(`Summarize "${cited.title ?? cited.url}"`, {
              ...filters,
              documentIds: [documentId],
            }),
  }
}
