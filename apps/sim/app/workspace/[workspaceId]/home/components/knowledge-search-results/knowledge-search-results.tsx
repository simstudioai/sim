'use client'

import { Chip, ChipLink } from '@sim/emcn-legacy'
import { ActivityStatus } from '@/components/ui/activity-status'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { useSession } from '@/lib/auth/client'
import type { ResourceScope } from '@/lib/core/resource-scope'
import {
  handleResultsKeyDown,
  liveSearchResultsKey,
  type SearchResultsProps,
  toSource,
} from '@/lib/knowledge/search/results'
import { SearchFilters } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results/search-filters'
import { SourceCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card'
import { useLiveSearchResults } from '@/hooks/sim-search/use-live-search-results'

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
}: KnowledgeSearchResultsProps) {
  const scope: ResourceScope = suppliedScope ?? { kind: 'workspace', workspaceId: workspaceId! }
  const { data: session } = useSession()
  const trimmed = query.trim()
  const Results = LiveSearchResults
  return (
    <Results
      key={liveSearchResultsKey(scope, session?.user?.id, trimmed)}
      scope={scope}
      query={trimmed}
      suppliedFilters={suppliedFilters}
      topK={topK}
      nativeQueries={nativeQueries}
      reuseFreshResult={reuseFreshResult}
      onSummarize={onSummarize}
    />
  )
}

/** Live results do not mount index or sync-status queries. */
function LiveSearchResults(props: SearchResultsProps) {
  const { scope, query } = props
  const {
    awaitingRange,
    isPending,
    isFetching,
    isError,
    refetch,
    documents,
    showFilterControls,
    sourceTypes,
    noResults,
    connectAppsHref,
    someAppsUnavailable,
    coverageIncomplete,
    summarizerFor,
  } = useLiveSearchResults(props)
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
      {showFilterControls && <SearchFilters sourceTypes={sourceTypes} />}
      {noResults && (
        <p className='px-2 py-2 text-[var(--text-muted)] text-caption'>Search found no results.</p>
      )}
      {connectAppsHref && (
        <div className='flex items-center gap-2 px-2 py-2'>
          <p role='status' className='text-[var(--text-muted)] text-caption'>
            No connected apps are available for this search.
          </p>
          <ChipLink variant='border' href={connectAppsHref}>
            Connect apps
          </ChipLink>
        </div>
      )}
      {someAppsUnavailable && (
        <p role='status' className='px-2 py-1 text-[var(--text-muted)] text-caption'>
          Some apps couldn’t be searched. Showing available results.
        </p>
      )}
      {coverageIncomplete && (
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
            onSummarize={summarizerFor(result.documentId)}
          />
        ))}
      </div>
    </div>
  )
}
