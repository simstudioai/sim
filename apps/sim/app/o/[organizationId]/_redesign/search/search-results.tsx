'use client'

import { Button, Chip } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { DateRangePicker } from '@sim/emcn/picker/date-picker'
import { InlineNotice } from '@sim/emcn/status'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import { useSession } from '@/lib/auth/client'
import type { ResourceScope } from '@/lib/core/resource-scope'
import styles from '@/app/o/[organizationId]/_redesign/search/search.module.css'
import { SourceRow } from '@/app/o/[organizationId]/_redesign/search/source-row'
import { useLiveSearchResults } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results/use-live-search-results'
import { useSearchFilterControls } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results/use-search-filter-controls'
import {
  handleResultsKeyDown,
  liveSearchResultsKey,
  toSource,
} from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results/utils'

function SearchFilterControls({ sourceTypes }: { sourceTypes: readonly string[] }) {
  const { source, updated, range } = useSearchFilterControls(sourceTypes)
  return (
    <div className={styles.filters} role='group' aria-label='Search filters'>
      <div className={styles.filter}>
        <ChoiceMenu
          label={source.label}
          value={source.value}
          options={source.options}
          onValueChange={source.onChange}
        />
      </div>
      <div className={styles.filter}>
        <ChoiceMenu
          label={updated.label}
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
        <InlineNotice
          intent='danger'
          message='Search couldn’t run.'
          action={
            <Button variant='quiet' size='compact' onClick={() => void results.refetch()}>
              Try again
            </Button>
          }
        />
      )}
      {results.showFilterControls && <SearchFilterControls sourceTypes={results.sourceTypes} />}
      {results.noResults && <EmptyState title='Search found no results.' />}
      {results.connectAppsHref && (
        <InlineNotice
          message='No connected apps are available for this search.'
          action={<Chip href={results.connectAppsHref}>Connect apps</Chip>}
        />
      )}
      {results.someAppsUnavailable && (
        <InlineNotice
          intent='warning'
          message='Some apps couldn’t be searched. Showing available results.'
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
