'use client'

import { useEffect, useMemo, useState } from 'react'
import { Chip } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import { ActivityStatus } from '@/components/ui/activity-status'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { useSession } from '@/lib/auth/auth-client'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { type ResourceScope, resourceScopeKey } from '@/lib/core/resource-scope'
import { IndexedSearchResults } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results/indexed'
import { SearchFilters } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results/search-filters'
import {
  groupResultsByDocument,
  handleResultsKeyDown,
  type SearchResultsProps,
  toSource,
} from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results/utils'
import { SourceCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card'
import {
  resourceUrlKeys,
  searchFilterParsers,
  searchFiltersFromParams,
} from '@/app/workspace/[workspaceId]/home/search-params'
import { useWorkspaceKnowledgeSearch } from '@/hooks/queries/kb/knowledge'

type KnowledgeSearchResultsProps = (
  | { workspaceId: string; scope?: never }
  | { scope: ResourceScope; workspaceId?: never }
) &
  Omit<SearchResultsProps, 'scope' | 'suppliedFilters'> & {
    /** A tool-owned search keeps its exact scope instead of inheriting page filters. */
    filters?: WorkspaceSearchFilters
  }

/** A new query or access scope starts a fresh search and rolling-date anchor. */
export function KnowledgeSearchResults({
  workspaceId,
  scope: suppliedScope,
  query,
  filters: suppliedFilters,
  topK,
  nativeQueries,
  reuseFreshResult,
  onSummarize,
  onSearchChange,
}: KnowledgeSearchResultsProps) {
  const scope: ResourceScope = suppliedScope ?? { kind: 'workspace', workspaceId: workspaceId! }
  const { data: session } = useSession()
  const trimmed = query.trim()
  const { features } = useDeploymentShape()
  const Results = features.liveEnterpriseSearch ? LiveSearchResults : IndexedSearchResults
  return (
    <Results
      key={JSON.stringify([resourceScopeKey(scope), session?.user?.id, trimmed])}
      scope={scope}
      query={trimmed}
      suppliedFilters={suppliedFilters}
      topK={topK}
      nativeQueries={nativeQueries}
      reuseFreshResult={reuseFreshResult}
      onSummarize={onSummarize}
      onSearchChange={onSearchChange}
    />
  )
}

/** Live results do not mount index or sync-status queries. */
function LiveSearchResults({
  scope,
  query,
  suppliedFilters,
  topK,
  nativeQueries,
  reuseFreshResult,
  onSummarize,
  onSearchChange,
}: SearchResultsProps) {
  const [hasShownFilters, setHasShownFilters] = useState(false)
  const [searchedAt] = useState(() => Date.now())
  const [params] = useQueryStates(searchFilterParsers, resourceUrlKeys)
  const filters = useMemo(
    () => suppliedFilters ?? searchFiltersFromParams(params, searchedAt),
    [suppliedFilters, params.source, params.updated, params.from, params.to, searchedAt]
  )
  const awaitingRange =
    !suppliedFilters && params.updated === 'custom' && !(params.from && params.to)
  const { data, isPending, isFetching, isError, refetch } = useWorkspaceKnowledgeSearch(
    scope,
    awaitingRange ? '' : query,
    filters,
    topK ?? 20,
    { nativeQueries, reuseFreshResult }
  )
  useEffect(() => {
    onSearchChange?.({
      scope,
      query,
      filters,
      ...(topK ? { topK } : {}),
      ...(nativeQueries ? { nativeQueries } : {}),
    })
  }, [
    scope.kind,
    scope.kind === 'organization' ? scope.organizationId : scope.workspaceId,
    query,
    filters,
    topK,
    nativeQueries,
    onSearchChange,
  ])
  const showFilters = hasShownFilters || data !== undefined || awaitingRange || isError
  if (showFilters && !hasShownFilters) setHasShownFilters(true)
  const documents = groupResultsByDocument(data?.results ?? [])
  const accounts = data?.live?.accounts ?? []
  const sources = [
    ...new Set([
      ...accounts.map((account) => account.provider),
      ...(filters.source ? [filters.source] : []),
    ]),
  ]
  return (
    <div aria-busy={!awaitingRange && isFetching} className='flex flex-col'>
      {!awaitingRange && isFetching && (
        <div className='px-2 py-2'>
          <ActivityStatus label={isPending ? 'Searching' : 'Updating results'} isActive />
        </div>
      )}
      {(awaitingRange || isError) && (
        <div className='flex items-center gap-2 px-2 py-2'>
          {awaitingRange ? (
            <p className='text-caption'>Choose the days to search.</p>
          ) : (
            <p role='status' className='text-[var(--text-muted)] text-caption'>
              Search couldn’t run.
            </p>
          )}
          {isError && (
            <Chip variant='border' onClick={() => void refetch()}>
              Try again
            </Chip>
          )}
        </div>
      )}
      {!suppliedFilters && showFilters && <SearchFilters sourceTypes={sources} />}
      {!awaitingRange &&
        !isPending &&
        !isFetching &&
        !isError &&
        data?.retrieval.status === 'complete' &&
        documents.length === 0 && (
          <p className='px-2 py-2 text-[var(--text-muted)] text-caption'>
            Search found no results.
          </p>
        )}
      {accounts.some((account) =>
        ['unavailable', 'timeout', 'rate_limited', 'reconnect'].includes(account.status)
      ) && (
        <p role='status' className='px-2 py-1 text-[var(--text-muted)] text-caption'>
          Some apps couldn’t be searched. Showing available results.
        </p>
      )}
      {!data?.live && data?.retrieval.status === 'partial' && (
        <p className='px-2 py-1 text-[var(--text-muted)] text-caption'>
          Coverage is incomplete. Narrow the query or ask Assistant to refine it.
        </p>
      )}
      <div
        role='region'
        aria-label='Search results'
        aria-busy={isFetching}
        className='flex flex-col'
        onKeyDown={handleResultsKeyDown}
      >
        {documents.map((result) => (
          <SourceCard
            key={result.documentId}
            source={toSource(result, query, scope)}
            query={query}
            onSummarize={
              isFetching
                ? undefined
                : (cited) =>
                    onSummarize(`Summarize "${cited.title ?? cited.url}"`, {
                      ...filters,
                      documentIds: [result.documentId],
                    })
            }
          />
        ))}
      </div>
    </div>
  )
}
