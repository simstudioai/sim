'use client'

import { useMemo } from 'react'
import { Button, Chip, OverflowText } from '@sim/emcn'
import { FileText } from '@sim/emcn/icons'
import { formatDate } from '@sim/utils/formatting'
import { useQueryStates } from 'nuqs'
import type { WorkspaceKnowledgeSearchResult } from '@/lib/api/contracts/knowledge'
import { matchSnippet } from '@/lib/knowledge/search/snippet'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import { searchedKnowledgeBases } from '@/lib/sim-search/knowledge-bases'
import {
  highlightTerms,
  SOURCE_ROW_CLASSES,
  SOURCE_ROW_MARK_CLASSES,
  SourceCard,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card'
import {
  isHttpUrl,
  type SourceTagData,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { isIndexing } from '@/app/workspace/[workspaceId]/home/components/search-sources'
import {
  resourceUrlKeys,
  searchFilterParsers,
  UPDATED_WINDOWS,
} from '@/app/workspace/[workspaceId]/home/search-params'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import {
  useWorkspaceMemberConnectors,
  type WorkspaceMemberConnector,
} from '@/hooks/queries/kb/connectors'
import { useKnowledgeBasesQuery, useWorkspaceKnowledgeSearch } from '@/hooks/queries/kb/knowledge'

const EMPTY_MEMBER_CONNECTORS: WorkspaceMemberConnector[] = []

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
 * The names of the sources still indexing for the viewer among the bases the
 * search spans, each once. A base outside the search cannot grow its results,
 * so its indexing is not the reader's concern here.
 */
export function indexingSourceNames(
  memberConnectors: readonly WorkspaceMemberConnector[],
  knowledgeBaseIds: readonly string[]
): string[] {
  const searched = new Set(knowledgeBaseIds)
  return [
    ...new Set(
      memberConnectors
        .filter((connection) => searched.has(connection.knowledgeBaseId) && isIndexing(connection))
        .map((connection) => connectorDisplayName(connection.connectorType))
    ),
  ]
}

/**
 * A result as the source card renders it: the row's second line names the
 * source app, or the knowledge base for an upload. A document without an
 * http(s) source URL cannot be opened, and a connector-supplied value of any
 * other scheme is never handed to the browser as a link.
 */
function toSource(result: WorkspaceKnowledgeSearchResult, query: string): SourceTagData | null {
  if (!isHttpUrl(result.sourceUrl)) return null
  return {
    url: result.sourceUrl,
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

interface UnlinkedResultRowProps {
  result: WorkspaceKnowledgeSearchResult
  query: string
}

/**
 * A document with nowhere to open, such as an upload: the same row as a
 * linked result, with the file mark in place of a brand mark, so the list's
 * columns and the matched passage stay aligned whatever the document is.
 */
function UnlinkedResultRow({ result, query }: UnlinkedResultRowProps) {
  const meta = [
    result.knowledgeBaseName,
    result.author,
    result.sourceModifiedAt ? formatDate(new Date(result.sourceModifiedAt)) : null,
  ].filter((part): part is string => Boolean(part))
  return (
    <div className={SOURCE_ROW_CLASSES}>
      <span className={SOURCE_ROW_MARK_CLASSES}>
        <FileText className='size-[16px] text-[var(--text-icon)]' />
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <OverflowText
          label={result.documentName ?? 'Untitled document'}
          className='text-[var(--text-primary)] text-sm'
        />
        <OverflowText label={meta.join(' · ')} className='text-[var(--text-muted)] text-caption' />
        <p className='line-clamp-2 text-[var(--text-body)] text-small leading-snug'>
          {highlightTerms(matchSnippet(result.content, query), query)}
        </p>
      </div>
    </div>
  )
}

interface KnowledgeSearchResultsProps {
  workspaceId: string
  query: string
  /** Asks the agent about one document; the prompt names it and links to it. */
  onSummarize: (prompt: string) => void
  /** Asks the agent the query itself, for a prose answer with citations. */
  onAnswer: (query: string) => void
}

/**
 * The composer's Search mode: the documents the signed-in person may read that
 * match their query, across every knowledge base in the workspace, as rows
 * that open the source. A header says how many and that the search ran as
 * them; while a connected source is still indexing it says so, and the list
 * grows as documents land. Filters by source and recency appear only once the
 * list is long and mixed enough to need them, and live in the URL beside the
 * query so a filtered search is a shareable link.
 */
export function KnowledgeSearchResults({
  workspaceId,
  query,
  onSummarize,
  onAnswer,
}: KnowledgeSearchResultsProps) {
  const {
    data: knowledgeBases = [],
    isPending: basesPending,
    error: basesError,
  } = useKnowledgeBasesQuery(workspaceId)
  const knowledgeBaseIds = searchedKnowledgeBases(knowledgeBases, workspaceId).map((kb) => kb.id)
  const {
    data: results,
    isPending,
    isFetching,
    isPlaceholderData,
    error,
  } = useWorkspaceKnowledgeSearch(workspaceId, knowledgeBaseIds, query)
  const { features } = useWorkspaceHostContext()
  /**
   * Judged by the workspace, as the server judges it: with per-member access
   * off, member-scoped documents are hidden, so no source is indexing anything
   * the viewer will see, and the list is not worth asking for.
   */
  const memberAccessAvailable = features?.knowledgeMemberAccess === true
  const { data: memberConnectorRows } = useWorkspaceMemberConnectors(workspaceId, {
    enabled: memberAccessAvailable,
  })
  /** Rows cached before the feature went off are not this surface's to show. */
  const memberConnectors = memberAccessAvailable
    ? (memberConnectorRows ?? EMPTY_MEMBER_CONNECTORS)
    : EMPTY_MEMBER_CONNECTORS
  const indexing = indexingSourceNames(memberConnectors, knowledgeBaseIds)
  const documents = useMemo(() => groupResultsByDocument(results ?? []), [results])
  const sourceTypes = useMemo(
    () => [...new Set(documents.map((result) => result.connectorType ?? UPLOAD_SOURCE))],
    [documents]
  )
  const [filters, setFilters] = useQueryStates(searchFilterParsers, resourceUrlKeys)
  const filtersActive = filters.source !== null || filters.updated !== 'any'
  /** The controls appear once the list is long and mixed, and stay while a filter from the link is active. */
  const showFilters =
    filtersActive || (documents.length >= FILTERS_MIN_RESULTS && sourceTypes.length > 1)
  const visible = useMemo(() => {
    if (!filtersActive) return documents
    const window = UPDATED_WINDOWS.find((entry) => entry.id === filters.updated)
    const cutoff = window?.days ? Date.now() - window.days * DAY_MS : null
    return documents.filter((result) => {
      if (filters.source && (result.connectorType ?? UPLOAD_SOURCE) !== filters.source) return false
      if (cutoff !== null) {
        const modified = result.sourceModifiedAt ? Date.parse(result.sourceModifiedAt) : Number.NaN
        if (Number.isNaN(modified) || modified < cutoff) return false
      }
      return true
    })
  }, [documents, filtersActive, filters.source, filters.updated])

  const failure = basesError ?? error
  if (failure) {
    return <p className='px-2 py-2 text-[var(--text-error)] text-caption'>{failure.message}</p>
  }
  if (!basesPending && knowledgeBaseIds.length === 0) {
    return (
      <p className='px-2 py-2 text-[var(--text-muted)] text-caption'>
        Nothing to search yet. Connect a source above to index what you can open.
      </p>
    )
  }
  /** Kept results belong to the previous query; a new query shows its own state. */
  if (isPending || isPlaceholderData || (isFetching && !results)) {
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
        <Button variant='ghost' size='sm' onClick={() => onAnswer(query)}>
          Answer with Sim
        </Button>
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
      {visible.length === 0 ? (
        <p className='px-2 py-2 text-[var(--text-muted)] text-caption'>
          {documents.length === 0
            ? `No documents you can read match “${query}”.`
            : 'No documents match these filters.'}
        </p>
      ) : (
        <div className='flex flex-col' onKeyDown={handleResultsKeyDown}>
          {visible.map((result) => {
            const source = toSource(result, query)
            return source ? (
              <SourceCard
                key={result.documentId}
                source={source}
                query={query}
                onSummarize={(cited) =>
                  onSummarize(`Summarize "${cited.title ?? cited.url}" (${cited.url})`)
                }
              />
            ) : (
              <UnlinkedResultRow key={result.documentId} result={result} query={query} />
            )
          })}
        </div>
      )}
    </div>
  )
}
