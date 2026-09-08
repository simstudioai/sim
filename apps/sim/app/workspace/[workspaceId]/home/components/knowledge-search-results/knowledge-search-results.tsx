'use client'

import { useMemo } from 'react'
import { Chip, ChipLink } from '@sim/emcn'
import { useQueryStates } from 'nuqs'
import type {
  WorkspaceKnowledgeSearchResult,
  WorkspaceSearchFilters,
} from '@/lib/api/contracts/knowledge'
import type { ResourceScope } from '@/lib/core/resource-scope'
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

/** Filters appear only once a list is long and mixed enough for them to help. */
const FILTERS_MIN_RESULTS = 10
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
  /** Binds the Assistant turn to the selected canonical document. */
  onSummarize: (prompt: string, filters: WorkspaceSearchFilters) => void
}

/**
 * The composer's Search mode: the documents the signed-in person may read that
 * match their query in the canonical Enterprise Search index, as rows
 * that open the source. A header says how many and that the search ran as
 * them; while a connected source is still indexing it says so, and the list
 * grows as documents land. Filters by source and recency appear only once the
 * list is long and mixed enough to need them, and live in the URL beside the
 * query so a filtered search is a shareable link.
 */
export function KnowledgeSearchResults({
  workspaceId,
  scope: suppliedScope,
  query,
  onSummarize,
}: KnowledgeSearchResultsProps) {
  const scope: ResourceScope = suppliedScope ?? { kind: 'workspace', workspaceId: workspaceId! }
  const {
    data: index,
    isPending: basesPending,
    isError: basesFailed,
    isFetching: basesFetching,
    refetch: refetchIndex,
  } = useSearchIndex(scope)
  const knowledgeBaseIds = index?.knowledgeBaseId ? [index.knowledgeBaseId] : []
  const [filters, setFilters] = useQueryStates(searchFilterParsers, resourceUrlKeys)
  const searchFilters = useMemo<WorkspaceSearchFilters>(() => {
    const window = UPDATED_WINDOWS.find((entry) => entry.id === filters.updated)
    return {
      ...(filters.source ? { source: filters.source } : {}),
      ...(window?.days
        ? { modifiedAfter: new Date(Date.now() - window.days * DAY_MS).toISOString() }
        : {}),
    }
  }, [filters.source, filters.updated])
  const {
    data: results,
    isPending,
    isFetching,
    isError: searchFailed,
    refetch: refetchSearch,
  } = useWorkspaceKnowledgeSearch(scope, query, searchFilters)
  const { data: overview } = useSearchSourceOverview(scope)
  const indexing = (overview?.providers ?? [])
    .filter((provider) => provider.isSyncing)
    .map((provider) => connectorDisplayName(provider.connectorType))
  const documents = useMemo(() => groupResultsByDocument(results ?? []), [results])
  const sourceTypes = [
    ...new Set([
      ...(filters.source ? [filters.source] : []),
      ...documents.map((result) => result.connectorType ?? UPLOAD_SOURCE),
    ]),
  ]
  const filtersActive = filters.source !== null || filters.updated !== 'any'
  /** The controls appear once the list is long and mixed, and stay while a filter from the link is active. */
  const showFilters =
    filtersActive || (documents.length >= FILTERS_MIN_RESULTS && sourceTypes.length > 1)

  /* A failed search says so in one quiet line and offers to run again; the cause is
     the server's to log, never the reader's to parse. */
  if (basesFailed || searchFailed) {
    const retrying = basesFetching || isFetching
    return (
      <div className='flex items-center gap-2 px-2 py-2'>
        <p className='text-[var(--text-muted)] text-caption'>Search couldn’t run.</p>
        <Chip
          variant='border'
          disabled={retrying}
          onClick={() => void (basesFailed ? refetchIndex() : refetchSearch())}
        >
          {retrying ? 'Retrying…' : 'Try again'}
        </Chip>
      </div>
    )
  }
  if (!basesPending && knowledgeBaseIds.length === 0) {
    return (
      <div className='flex items-center gap-2 px-2 py-2'>
        <p className='text-[var(--text-muted)] text-caption'>No sources are set up yet.</p>
        <ChipLink
          href={
            scope.kind === 'organization'
              ? `/o/${scope.organizationId}/integrations`
              : `/workspace/${scope.workspaceId}/search`
          }
        >
          View sources
        </ChipLink>
      </div>
    )
  }
  if (isPending || (isFetching && !results)) {
    return <p className='px-2 py-2 text-[var(--text-muted)] text-caption'>Searching…</p>
  }

  const indexingNote =
    indexing.length > 0
      ? `Still indexing ${indexing.join(', ')}; results grow as documents land.`
      : null

  return (
    <div className='flex flex-col'>
      <div className='flex items-center gap-2 px-2 py-2'>
        <span className='min-w-0 flex-1 text-[var(--text-muted)] text-caption'>
          <span className='tabular-nums'>
            {documents.length === 1 ? '1 document' : `${documents.length} documents`}
          </span>
          {' · searched as you'}
          {indexingNote && <span className='block'>{indexingNote}</span>}
        </span>
      </div>
      {showFilters && (
        <div className='flex flex-wrap items-center gap-1.5 px-2 pb-2'>
          <Chip
            shape='round'
            active={filters.source === null}
            onClick={() => setFilters({ source: null })}
          >
            All sources
          </Chip>
          {sourceTypes.map((type) => (
            <Chip
              key={type}
              shape='round'
              active={filters.source === type}
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
              onClick={() => setFilters({ updated: window.id })}
            >
              {window.label}
            </Chip>
          ))}
        </div>
      )}
      {documents.length === 0 ? (
        <p className='px-2 py-2 text-[var(--text-muted)] text-caption'>
          {filtersActive
            ? 'No documents match these filters.'
            : `No documents you can read match “${query}”.`}
        </p>
      ) : (
        <div className='flex flex-col' onKeyDown={handleResultsKeyDown}>
          {documents.map((result) => {
            const source = toSource(result, query, scope)
            return (
              <SourceCard
                key={result.documentId}
                source={source}
                query={query}
                onSummarize={(cited) =>
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
}
