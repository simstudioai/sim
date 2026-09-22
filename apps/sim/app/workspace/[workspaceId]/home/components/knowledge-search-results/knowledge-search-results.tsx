'use client'

import { useEffect, useMemo, useState } from 'react'
import { Chip, ChipDatePicker, ChipLink, cn } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import { ActivityStatus } from '@/components/ui/activity-status'
import {
  WORKSPACE_KNOWLEDGE_SEARCH_LIMITS,
  type WorkspaceKnowledgeSearchResult,
  type WorkspaceSearchFilters,
} from '@/lib/api/contracts/knowledge'
import { useSession } from '@/lib/auth/auth-client'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { type ResourceScope, resourceScopeKey } from '@/lib/core/resource-scope'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { matchSnippet } from '@/lib/knowledge/search/snippet'
import type { SearchResource } from '@/lib/mothership/generated/resources'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import { SourceCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card'
import {
  isHttpUrl,
  type SourceTagData,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import {
  resourceUrlKeys,
  searchFilterParsers,
  searchFiltersFromParams,
  UPDATED_WINDOWS,
} from '@/app/workspace/[workspaceId]/home/search-params'
import { useSearchIndex, useSearchSourceOverview } from '@/hooks/queries/kb/connectors'
import { useWorkspaceKnowledgeSearch } from '@/hooks/queries/kb/knowledge'

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
  /** A tool-owned search keeps its exact scope instead of inheriting page filters. */
  filters?: WorkspaceSearchFilters
  topK?: number
  /** Binds the Assistant turn to the selected canonical document. */
  onSummarize: (prompt: string, filters: WorkspaceSearchFilters) => void
  onSearchChange?: (search: SearchResource) => void
}

/** A new query or access scope starts a fresh search and rolling-date anchor. */
export function KnowledgeSearchResults({
  workspaceId,
  scope: suppliedScope,
  query,
  filters: suppliedFilters,
  topK,
  onSummarize,
  onSearchChange,
}: KnowledgeSearchResultsProps) {
  const scope: ResourceScope = suppliedScope ?? { kind: 'workspace', workspaceId: workspaceId! }
  const { data: session } = useSession()
  const trimmed = query.trim()
  const { features } = useDeploymentShape()
  const Results = features.liveEnterpriseSearch ? LiveSearchResults : SearchResults
  return (
    <Results
      key={JSON.stringify([resourceScopeKey(scope), session?.user?.id, trimmed])}
      scope={scope}
      query={trimmed}
      suppliedFilters={suppliedFilters}
      topK={topK}
      onSummarize={onSummarize}
      onSearchChange={onSearchChange}
    />
  )
}

interface SearchResultsProps {
  suppliedFilters?: WorkspaceSearchFilters
  topK?: number
  scope: ResourceScope
  query: string
  onSummarize: KnowledgeSearchResultsProps['onSummarize']
  onSearchChange: KnowledgeSearchResultsProps['onSearchChange']
}

function SearchResults({
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
  const [filters, setFilters] = useQueryStates(searchFilterParsers, resourceUrlKeys)
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
        : WORKSPACE_KNOWLEDGE_SEARCH_LIMITS.initial)
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
    <div className='flex flex-col'>
      <div className='flex items-center gap-2 px-2 py-2'>
        <div className='min-w-0 flex-1'>
          {awaitingRange ? (
            <p role='status' className='text-[var(--text-muted)] text-caption'>
              Choose the days to search.
            </p>
          ) : fetching || (pending && !failed) ? (
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
      {suppliedFilters === undefined && showFilters && (
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
              onClick={() =>
                setFilters(
                  window.id === 'custom'
                    ? { updated: window.id }
                    : { updated: window.id, from: null, to: null }
                )
              }
            >
              {window.label}
            </Chip>
          ))}
          {custom && (
            <ChipDatePicker
              mode='range'
              placeholder='Updated between'
              startDate={filters.from?.toISOString().slice(0, 10)}
              endDate={filters.to?.toISOString().slice(0, 10)}
              onRangeChange={(start, end) =>
                void setFilters({ from: new Date(start), to: new Date(end) })
              }
              onClear={() => void setFilters({ from: null, to: null })}
            />
          )}
        </div>
      )}
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

/** Live results do not mount index or sync-status queries. */
function LiveSearchResults({
  scope,
  query,
  suppliedFilters,
  topK,
  onSummarize,
  onSearchChange,
}: SearchResultsProps) {
  const [searchedAt] = useState(() => Date.now())
  const [params, setParams] = useQueryStates(searchFilterParsers, resourceUrlKeys)
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
    topK ?? 20
  )
  useEffect(() => {
    onSearchChange?.({ scope, query, filters, ...(topK ? { topK } : {}) })
  }, [
    scope.kind,
    scope.kind === 'organization' ? scope.organizationId : scope.workspaceId,
    query,
    filters,
    topK,
    onSearchChange,
  ])
  const documents = groupResultsByDocument(data?.results ?? [])
  const accounts = data?.live?.accounts ?? []
  const sources = [
    ...new Set([
      ...accounts.map((account) => account.provider),
      ...(filters.source ? [filters.source] : []),
    ]),
  ]
  return (
    <div className='flex flex-col'>
      <div className='flex items-center gap-2 px-2 py-2'>
        {awaitingRange ? (
          <p className='text-caption'>Choose the days to search.</p>
        ) : isPending || isFetching ? (
          <ActivityStatus label='Searching connected accounts…' isActive />
        ) : (
          <p role='status' className='text-[var(--text-muted)] text-caption'>
            {isError
              ? 'Search couldn’t run.'
              : `${documents.length} results · searched live as you`}
          </p>
        )}
        {isError && (
          <Chip variant='border' onClick={() => void refetch()}>
            Try again
          </Chip>
        )}
      </div>
      {!suppliedFilters && (
        <div className='flex flex-wrap gap-2 px-2 py-2'>
          <Chip variant='border' onClick={() => void setParams({ source: null })}>
            All sources
          </Chip>
          {sources.map((source) => (
            <Chip key={source} variant='border' onClick={() => void setParams({ source })}>
              {connectorDisplayName(source)}
            </Chip>
          ))}
          {UPDATED_WINDOWS.map((window) => (
            <Chip
              key={window.id}
              variant='border'
              onClick={() =>
                void setParams(
                  window.id === 'custom'
                    ? { updated: window.id }
                    : { updated: window.id, from: null, to: null }
                )
              }
            >
              {window.label}
            </Chip>
          ))}
          {params.updated === 'custom' && (
            <ChipDatePicker
              mode='range'
              placeholder='Updated between'
              startDate={params.from?.toISOString().slice(0, 10)}
              endDate={params.to?.toISOString().slice(0, 10)}
              onRangeChange={(start, end) =>
                void setParams({ from: new Date(start), to: new Date(end) })
              }
              onClear={() => void setParams({ from: null, to: null })}
            />
          )}
        </div>
      )}
      {!isPending && !isError && data?.live && accounts.length === 0 && (
        <div className='flex items-center gap-2 px-2 py-2'>
          <p className='text-caption'>
            Connect an enabled app, or ask an admin to configure search.
          </p>
          <ChipLink
            href={
              scope.kind === 'organization'
                ? `/o/${scope.organizationId}/integrations`
                : `/workspace/${scope.workspaceId}/integrations`
            }
          >
            Connected accounts
          </ChipLink>
        </div>
      )}
      {accounts.some((account) => account.status === 'reconnect') && (
        <div role='status' className='flex items-center gap-2 px-2 py-2 text-caption'>
          <span>
            {[
              ...new Set(
                accounts
                  .filter((account) => account.status === 'reconnect')
                  .map((account) => connectorDisplayName(account.provider))
              ),
            ].join(', ')}{' '}
            needs to reconnect.
          </span>
          <ChipLink
            href={
              scope.kind === 'organization'
                ? `/o/${scope.organizationId}/integrations`
                : `/workspace/${scope.workspaceId}/integrations`
            }
          >
            Manage connections
          </ChipLink>
        </div>
      )}
      {accounts.some((account) =>
        ['unavailable', 'timeout', 'rate_limited'].includes(account.status)
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
