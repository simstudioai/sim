'use client'

import { useEffect, useMemo, useState } from 'react'
import { Chip, ChipLink, cn } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import { ActivityStatus } from '@/components/ui/activity-status'
import { WORKSPACE_KNOWLEDGE_SEARCH_LIMITS } from '@/lib/api/contracts/knowledge'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
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
import { useSearchIndex, useSearchSourceOverview } from '@/hooks/queries/kb/connectors'
import { useWorkspaceKnowledgeSearch } from '@/hooks/queries/kb/knowledge'

/** Every result without a connector is an upload; the filter names them so. */
const UPLOAD_SOURCE = 'upload'

/** Results from indexed organization search, rendered only while the deployment serves it. */
export function IndexedSearchResults({
  scope,
  query,
  onSummarize,
  onSearchChange,
  suppliedFilters,
  topK,
}: SearchResultsProps) {
  const [hasShownFilters, setHasShownFilters] = useState(false)
  const [searchedAt] = useState(Date.now)
  /**
   * More results are a second, wider search: the first paint stays as quick as it is, and a
   * refinement of the filters starts over at the first page.
   */
  const [expandedFor, setExpandedFor] = useState<string | null>(null)
  const {
    data: index,
    isPending: basesPending,
    isError: basesFailed,
    isFetching: basesFetching,
    refetch: refetchIndex,
  } = useSearchIndex(scope)
  const [filters] = useQueryStates(searchFilterParsers, resourceUrlKeys)
  const custom = filters.updated === 'custom'
  const pageFilters = useMemo(
    () => searchFiltersFromParams(filters, searchedAt),
    [filters.source, filters.updated, filters.from, filters.to, searchedAt]
  )
  const searchFilters = suppliedFilters ?? pageFilters
  const scopeId = scope.kind === 'organization' ? scope.organizationId : scope.workspaceId
  useEffect(() => {
    onSearchChange?.({ scope, query, filters: searchFilters, ...(topK ? { topK } : {}) })
  }, [scope.kind, scopeId, query, searchFilters, topK, onSearchChange])
  const filtersKey = JSON.stringify(searchFilters)
  const expanded = expandedFor === filtersKey
  /** A custom window is two-ended: until both days are chosen, nothing is searched. */
  const awaitingRange = !suppliedFilters && custom && !(filters.from && filters.to)
  const {
    data: search,
    isPending,
    isFetching,
    isPlaceholderData,
    isError: searchFailed,
    refetch: refetchSearch,
  } = useWorkspaceKnowledgeSearch(
    scope,
    awaitingRange ? '' : query,
    searchFilters,
    topK ??
      (expanded
        ? WORKSPACE_KNOWLEDGE_SEARCH_LIMITS.expanded
        : WORKSPACE_KNOWLEDGE_SEARCH_LIMITS.initial),
    { retainAcrossLimits: topK === undefined }
  )
  /** A full first page may collapse to few cards, yet more documents may still match. */
  const mayHaveMore =
    topK === undefined &&
    !expanded &&
    (search?.results.length ?? 0) >= WORKSPACE_KNOWLEDGE_SEARCH_LIMITS.initial
  const { data: overview } = useSearchSourceOverview(scope)
  const indexing = (overview?.providers ?? [])
    .filter((provider) => provider.isSyncing)
    .map((provider) => connectorDisplayName(provider.connectorType))
  const documents = groupResultsByDocument(search?.results ?? [])
  const sourceTypes = [
    ...new Set([
      ...(filters.source ? [filters.source] : []),
      ...(overview?.providers.map((provider) => provider.connectorType) ?? []),
      UPLOAD_SOURCE,
    ]),
  ].sort((left, right) => connectorDisplayName(left).localeCompare(connectorDisplayName(right)))
  const failed = basesFailed || searchFailed
  const pending = basesPending || isPending
  const fetching = basesFetching || isFetching
  const noSources = !basesPending && !basesFailed && !index?.knowledgeBaseId
  const partial = search?.retrieval.status === 'partial'
  const documentCount = documents.length === 1 ? '1 document' : `${documents.length} documents`

  const indexingNote =
    indexing.length > 0
      ? `Still indexing ${indexing.join(', ')}; results grow as documents land.`
      : null

  const showResults = !noSources && !failed && !basesPending && documents.length > 0
  /** A custom window waiting for its days must show the filters, or the picker is unreachable. */
  const showFilters =
    hasShownFilters ||
    showResults ||
    awaitingRange ||
    (!noSources && !pending && !failed && !!search && !partial)
  if (showFilters && !hasShownFilters) setHasShownFilters(true)

  return noSources ? (
    <div className='flex items-center gap-2 px-2 py-2'>
      <p className='text-[var(--text-muted)] text-caption'>No sources are set up yet.</p>
      <ChipLink
        href={
          scope.kind === 'organization'
            ? `/o/${scope.organizationId}/integrations`
            : `/workspace/${scope.workspaceId}/knowledge`
        }
      >
        View sources
      </ChipLink>
    </div>
  ) : (
    <div aria-busy={!awaitingRange && fetching} className='flex flex-col'>
      <div className='flex items-center gap-2 px-2 py-2'>
        <div className='min-w-0 flex-1'>
          {awaitingRange ? (
            <p role='status' className='text-[var(--text-muted)] text-caption'>
              Choose the days to search.
            </p>
          ) : fetching ? (
            <ActivityStatus label={pending ? 'Searching' : 'Updating results'} isActive />
          ) : pending && !failed ? null : (
            <p role='status' className='text-[var(--text-muted)] text-caption'>
              {failed
                ? 'Search couldn’t run.'
                : partial
                  ? documents.length === 0
                    ? 'Search timed out.'
                    : `${documentCount} · some results may be missing.`
                  : documents.length === 0
                    ? 'Search found no results.'
                    : `${documentCount} · searched as you`}
            </p>
          )}
          {indexingNote && !failed && !partial && (
            <p className='text-[var(--text-muted)] text-caption'>{indexingNote}</p>
          )}
        </div>
        {(failed || partial) && (
          <Chip
            variant='border'
            disabled={fetching}
            onClick={() => void (basesFailed ? refetchIndex() : refetchSearch())}
          >
            {fetching ? 'Retrying' : 'Try again'}
          </Chip>
        )}
      </div>
      {suppliedFilters === undefined && showFilters && <SearchFilters sourceTypes={sourceTypes} />}
      {showResults && (
        <div
          role='region'
          aria-label='Search results'
          aria-busy={isFetching}
          className={cn('flex flex-col', isPlaceholderData && 'opacity-60')}
          onKeyDown={handleResultsKeyDown}
        >
          {documents.map((result) => {
            const source = toSource(result, query, scope)
            return (
              <SourceCard
                key={result.documentId}
                source={source}
                query={query}
                onSummarize={
                  isPlaceholderData
                    ? undefined
                    : (cited) =>
                        onSummarize(`Summarize "${cited.title ?? cited.url}"`, {
                          ...searchFilters,
                          documentIds: [result.documentId],
                        })
                }
              />
            )
          })}
          {mayHaveMore && (
            <div className='flex px-2 py-2'>
              <Chip
                variant='border'
                disabled={isFetching}
                onClick={() => setExpandedFor(filtersKey)}
              >
                Show more
              </Chip>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
