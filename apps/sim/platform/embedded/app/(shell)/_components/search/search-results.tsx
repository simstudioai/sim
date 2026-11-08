'use client'

import { Chip } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { DateRangePicker } from '@sim/emcn/picker/date-picker'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { useSession } from '@/lib/auth/client'
import type { ResourceScope } from '@/lib/core/resource-scope'
import {
  handleResultsKeyDown,
  liveSearchResultsKey,
  toSource,
} from '@/lib/knowledge/search/results'
import { useLiveSearchResults } from '@/hooks/sim-search/use-live-search-results'
import { useSearchFilterControls } from '@/hooks/sim-search/use-search-filter-controls'
import styles from '@/platform/embedded/app/(shell)/_components/search/search.module.css'
import { SourceRow } from '@/platform/embedded/app/(shell)/_components/search/source-row'

function SearchFilterControls({ sourceTypes }: { sourceTypes: readonly string[] }) {
  const { source, updated, range } = useSearchFilterControls(sourceTypes)
  return (
    <div className={styles.filters} role='group' aria-label='Search filters'>
      <div className={styles.filter}>
        <ChoiceMenu
          label='Filter by source'
          value={source.value}
          options={source.options}
          onValueChange={source.onChange}
        />
      </div>
      <div className={styles.filter}>
        <ChoiceMenu
          label='Filter by date'
          value={updated.value}
          options={updated.options}
          onValueChange={updated.onChange}
        />
      </div>
      {range && (
        <div className={styles.range}>
          <DateRangePicker
            label='Updated between'
            labelHidden
            placeholder='Updated between'
            clearable
            value={range.start && range.end ? { start: range.start, end: range.end } : null}
            onValueChange={(next) =>
              next ? range.onChange(next.start, next.end) : range.onClear()
            }
          />
        </div>
      )}
    </div>
  )
}

interface LiveResultsProps {
  scope: ResourceScope
  query: string
  onSummarize?: (prompt: string, filters: WorkspaceSearchFilters) => void
}

function LiveResults({ scope, query, onSummarize }: LiveResultsProps) {
  const results = useLiveSearchResults({ scope, query, onSummarize })
  const { awaitingRange, isFetching, isPending, isError } = results
  return (
    <div className={styles.results} aria-busy={!awaitingRange && isFetching}>
      {!awaitingRange && isFetching && (
        <p className={styles.quiet} data-type='T060' role='status'>
          {isPending ? 'Searching' : 'Updating results'}
        </p>
      )}
      {awaitingRange && <p data-type='T060'>Choose the days to search.</p>}
      {isError && (
        <FailureNotice
          message='Search couldn’t run.'
          retrying={isFetching}
          onRetry={() => void results.refetch()}
        />
      )}
      {results.showFilterControls && <SearchFilterControls sourceTypes={results.sourceTypes} />}
      {results.noResults && <EmptyState title='Search found no results.' />}
      {results.connectAppsHref && (
        <InlineNotice
          message='No connected integrations are available for this search.'
          action={<Chip href={results.connectAppsHref}>Connect integrations</Chip>}
        />
      )}
      {results.someAppsUnavailable && (
        <InlineNotice
          intent='warning'
          message='Some integrations couldn’t be searched. Showing available results.'
        />
      )}
      {results.coverageIncomplete && (
        <InlineNotice
          intent='warning'
          message='Coverage is incomplete. Narrow the query or ask Assistant to refine it.'
        />
      )}
      <div
        className={styles.rows}
        role='region'
        aria-label='Search results'
        aria-busy={isFetching}
        onKeyDown={handleResultsKeyDown}
      >
        {results.documents.map((result) => (
          <SourceRow
            key={result.documentId}
            source={toSource(result, query, scope)}
            query={query}
            onSummarize={results.summarizerFor(result.documentId)}
          />
        ))}
      </div>
    </div>
  )
}

/** A query's results. A new query, reader or scope remounts them, restarting the date anchor. */
export function SearchResults({ scope, query, onSummarize }: LiveResultsProps) {
  const { data: session } = useSession()
  return (
    <LiveResults
      key={liveSearchResultsKey(scope, session?.user?.id, query)}
      scope={scope}
      query={query}
      onSummarize={onSummarize}
    />
  )
}
