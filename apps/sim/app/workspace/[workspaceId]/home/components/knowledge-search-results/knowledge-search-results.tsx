'use client'

import { type ReactNode, useState } from 'react'
import { Chip, ChipLink, cn } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import { ActivityStatus } from '@/components/ui/activity-status'
import type {
  WorkspaceKnowledgeSearchResult,
  WorkspaceSearchFilters,
} from '@/lib/api/contracts/knowledge'
import { useSession } from '@/lib/auth/auth-client'
import { type ResourceScope, resourceScopeKey } from '@/lib/core/resource-scope'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { matchSnippet } from '@/lib/knowledge/search/snippet'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import { SourceCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card'
import {
  isHttpUrl,
  type SourceTagData,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import {
  resourceUrlKeys,
  searchFilterParsers,
  UPDATED_WINDOWS,
} from '@/app/workspace/[workspaceId]/home/search-params'
import { useSearchIndex, useSearchSourceOverview } from '@/hooks/queries/kb/connectors'
import { useWorkspaceKnowledgeSearch } from '@/hooks/queries/kb/knowledge'

const DAY_MS = 24 * 60 * 60 * 1000
/** Every result without a connector is an upload; the filter names them so. */
const UPLOAD_SOURCE = 'upload'

/**
 * One card per document, keeping the best-ranked chunk of each: the list is
 * already in rank order, so the first chunk seen for a document is its best.
 */
export function groupResultsByDocument(
  results: readonly WorkspaceKnowledgeSearchResult[]
): WorkspaceKnowledgeSearchResult[] {
  const seen = new Set<string>()
  const grouped: WorkspaceKnowledgeSearchResult[] = []
  for (const result of results) {
    if (seen.has(result.documentId)) continue
    seen.add(result.documentId)
    grouped.push(result)
  }
  return grouped
}

/**
 * A result as the source card renders it: the row's second line names the
 * source app, or the knowledge base for an upload. Without an HTTP(S) source
 * URL, the link opens the canonical document in Sim.
 */
function toSource(
  result: WorkspaceKnowledgeSearchResult,
  query: string,
  scope: ResourceScope
): SourceTagData {
  return {
    url: isHttpUrl(result.sourceUrl)
      ? result.sourceUrl
      : `${getBaseUrl()}${scope.kind === 'organization' ? `/o/${encodeURIComponent(scope.organizationId)}` : `/workspace/${encodeURIComponent(scope.workspaceId)}`}/knowledge/${encodeURIComponent(result.knowledgeBaseId)}/${encodeURIComponent(result.documentId)}`,
    title: result.documentName ?? undefined,
    siteName: result.connectorType
      ? connectorDisplayName(result.connectorType)
      : result.knowledgeBaseName || undefined,
    connectorType: result.connectorType ?? undefined,
    snippet: matchSnippet(result.content, query),
    author: result.author ?? undefined,
    updatedAt: result.sourceModifiedAt ?? undefined,
  }
}

/**
 * Arrow keys walk the result links, the way a search page does; Enter on a
 * focused link opens it natively. Focus stops at either end.
 */
function handleResultsKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const links = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('a[data-source-link]')]
  if (links.length === 0) return
  const index = links.findIndex((link) => link === document.activeElement)
  if (index < 0) return
  const next =
    event.key === 'ArrowDown' ? Math.min(index + 1, links.length - 1) : Math.max(index - 1, 0)
  if (next === index) return
  event.preventDefault()
  links[next].focus()
}

type KnowledgeSearchResultsProps = (
  | { workspaceId: string; scope?: never }
  | { scope: ResourceScope; workspaceId?: never }
) & {
  query: string
  /** Lets the page dock its header after this query has displayed results. */
  renderLayout?: (results: ReactNode, hasDisplayedResults: boolean) => ReactNode
  /** Binds the Assistant turn to the selected canonical document. */
  onSummarize: (prompt: string, filters: WorkspaceSearchFilters) => void
}

/** A new query or access scope starts a fresh search and rolling-date anchor. */
export function KnowledgeSearchResults({
  workspaceId,
  scope: suppliedScope,
  query,
  onSummarize,
  renderLayout,
}: KnowledgeSearchResultsProps) {
  const scope: ResourceScope = suppliedScope ?? { kind: 'workspace', workspaceId: workspaceId! }
  const { data: session } = useSession()
  const trimmed = query.trim()
  return (
    <SearchResults
      key={JSON.stringify([resourceScopeKey(scope), session?.user?.id, trimmed])}
      scope={scope}
      query={trimmed}
      onSummarize={onSummarize}
      renderLayout={renderLayout}
    />
  )
}

interface SearchResultsProps {
  scope: ResourceScope
  query: string
  onSummarize: KnowledgeSearchResultsProps['onSummarize']
  renderLayout: KnowledgeSearchResultsProps['renderLayout']
}

function SearchResults({ scope, query, onSummarize, renderLayout }: SearchResultsProps) {
  const [hasDisplayedResults, setHasDisplayedResults] = useState(false)
  const [searchedAt] = useState(Date.now)
  const {
    data: index,
    isPending: basesPending,
    isError: basesFailed,
    isFetching: basesFetching,
    refetch: refetchIndex,
  } = useSearchIndex(scope)
  const [filters, setFilters] = useQueryStates(searchFilterParsers, resourceUrlKeys)
  const window = UPDATED_WINDOWS.find((entry) => entry.id === filters.updated)
  const searchFilters: WorkspaceSearchFilters = {
    ...(filters.source ? { source: filters.source } : {}),
    ...(window?.days
      ? { modifiedAfter: new Date(searchedAt - window.days * DAY_MS).toISOString() }
      : {}),
  }
  const {
    data: search,
    isPending,
    isFetching,
    isPlaceholderData,
    isError: searchFailed,
    refetch: refetchSearch,
  } = useWorkspaceKnowledgeSearch(scope, query, searchFilters)
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
  if (showResults && !hasDisplayedResults) setHasDisplayedResults(true)

  const content = noSources ? (
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
    <div className='flex flex-col'>
      <div className='flex items-center gap-2 px-2 py-2'>
        <div className='min-w-0 flex-1'>
          {fetching || (pending && !failed) ? (
            <ActivityStatus label={pending ? 'Searching…' : 'Updating results…'} isActive />
          ) : (
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
            {fetching ? 'Retrying…' : 'Try again'}
          </Chip>
        )}
      </div>
      <div
        role='group'
        aria-label='Search filters'
        className='flex flex-wrap items-center gap-1.5 px-2 pb-2'
      >
        <Chip
          shape='round'
          active={filters.source === null}
          aria-pressed={filters.source === null}
          onClick={() => setFilters({ source: null })}
        >
          All sources
        </Chip>
        {sourceTypes.map((type) => (
          <Chip
            key={type}
            shape='round'
            active={filters.source === type}
            aria-pressed={filters.source === type}
            onClick={() => setFilters({ source: filters.source === type ? null : type })}
          >
            {type === UPLOAD_SOURCE ? 'Uploads' : connectorDisplayName(type)}
          </Chip>
        ))}
        <span aria-hidden className='mx-0.5 h-[16px] w-px bg-[var(--border)]' />
        {UPDATED_WINDOWS.map((window) => (
          <Chip
            key={window.id}
            shape='round'
            active={filters.updated === window.id}
            aria-pressed={filters.updated === window.id}
            onClick={() => setFilters({ updated: window.id })}
          >
            {window.label}
          </Chip>
        ))}
      </div>
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
        </div>
      )}
    </div>
  )
  return renderLayout ? renderLayout(content, hasDisplayedResults || showResults) : content
}
