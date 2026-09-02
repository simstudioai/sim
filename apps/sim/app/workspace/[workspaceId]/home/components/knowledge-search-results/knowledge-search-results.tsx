'use client'

import { useMemo, useState } from 'react'
import { Button, Chip } from '@sim/emcn'
import type { WorkspaceKnowledgeSearchResult } from '@/lib/api/contracts/knowledge'
import { SourceCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { isIndexing } from '@/app/workspace/[workspaceId]/home/components/search-sources'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { useWorkspaceMemberConnectors } from '@/hooks/queries/kb/connectors'
import { useKnowledgeBasesQuery, useWorkspaceKnowledgeSearch } from '@/hooks/queries/kb/knowledge'

/** A search spans at most this many knowledge bases. */
const MAX_SEARCHED_KNOWLEDGE_BASES = 20
/** Characters of the matching chunk shown under a result. */
const SNIPPET_LENGTH = 280
/** Filters appear only once a list is long and mixed enough for them to help. */
const FILTERS_MIN_RESULTS = 10
const DAY_MS = 24 * 60 * 60 * 1000

const UPDATED_WINDOWS = [
  { id: 'any', label: 'Any time', days: null },
  { id: '7d', label: 'Past week', days: 7 },
  { id: '30d', label: 'Past month', days: 30 },
] as const
type UpdatedWindow = (typeof UPDATED_WINDOWS)[number]['id']

function toSnippet(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > SNIPPET_LENGTH ? `${flat.slice(0, SNIPPET_LENGTH).trimEnd()}…` : flat
}

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
 * source app, or the knowledge base for an upload. A document without a
 * source URL cannot be opened.
 */
function toSource(result: WorkspaceKnowledgeSearchResult): SourceTagData | null {
  if (!result.sourceUrl) return null
  return {
    url: result.sourceUrl,
    title: result.documentName ?? undefined,
    siteName: result.connectorType
      ? connectorName(result.connectorType)
      : result.knowledgeBaseName || undefined,
    connectorType: result.connectorType ?? undefined,
    snippet: toSnippet(result.content),
    updatedAt: result.sourceModifiedAt ?? undefined,
  }
}

function connectorName(connectorType: string): string {
  return CONNECTOR_META_REGISTRY[connectorType]?.name ?? connectorType
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
 * list is long and mixed enough to need them.
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
  /**
   * The list also carries the viewer's legacy personal bases, which have no
   * workspace; a search names one workspace and refuses a base outside it.
   */
  const knowledgeBaseIds = useMemo(
    () =>
      knowledgeBases
        .filter((kb) => kb.workspaceId === workspaceId)
        .slice(0, MAX_SEARCHED_KNOWLEDGE_BASES)
        .map((kb) => kb.id),
    [knowledgeBases, workspaceId]
  )
  const {
    data: results,
    isPending,
    isFetching,
    error,
  } = useWorkspaceKnowledgeSearch(workspaceId, knowledgeBaseIds, query)
  const { data: memberConnectors = [] } = useWorkspaceMemberConnectors(workspaceId)
  /** Every per-member connector still indexing for the viewer, in any base the search spans. */
  const indexing = useMemo(
    () => [
      ...new Set(
        memberConnectors
          .filter(isIndexing)
          .map((connection) => connectorName(connection.connectorType))
      ),
    ],
    [memberConnectors]
  )
  const documents = useMemo(() => groupResultsByDocument(results ?? []), [results])
  const sourceTypes = useMemo(
    () => [...new Set(documents.map((result) => result.connectorType ?? 'upload'))],
    [documents]
  )
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)
  const [updatedFilter, setUpdatedFilter] = useState<UpdatedWindow>('any')
  const showFilters = documents.length >= FILTERS_MIN_RESULTS && sourceTypes.length > 1
  const visible = useMemo(() => {
    if (!showFilters) return documents
    const window = UPDATED_WINDOWS.find((entry) => entry.id === updatedFilter)
    const cutoff = window?.days ? Date.now() - window.days * DAY_MS : null
    return documents.filter((result) => {
      if (sourceFilter && (result.connectorType ?? 'upload') !== sourceFilter) return false
      if (cutoff !== null) {
        const modified = result.sourceModifiedAt ? Date.parse(result.sourceModifiedAt) : Number.NaN
        if (Number.isNaN(modified) || modified < cutoff) return false
      }
      return true
    })
  }, [documents, showFilters, sourceFilter, updatedFilter])

  const failure = basesError ?? error
  if (failure) {
    return <p className='px-2 py-3 text-[var(--text-error)] text-small'>{failure.message}</p>
  }
  if (!basesPending && knowledgeBaseIds.length === 0) {
    return (
      <p className='px-2 py-3 text-[var(--text-muted)] text-small'>
        Nothing to search yet. Connect a source above to index what you can open.
      </p>
    )
  }
  if (isPending || (isFetching && !results)) {
    return <p className='px-2 py-3 text-[var(--text-muted)] text-small'>Searching…</p>
  }

  const indexingNote =
    indexing.length > 0
      ? `Still indexing ${indexing.join(', ')}; results grow as documents land.`
      : null

  return (
    <div className='flex flex-col gap-1'>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1'>
        <span className='text-[var(--text-muted)] text-caption'>
          {documents.length === 1 ? '1 document' : `${documents.length} documents`} · searched as
          you
          {indexingNote ? ` · ${indexingNote}` : ''}
        </span>
        <Button variant='ghost' size='sm' className='ml-auto' onClick={() => onAnswer(query)}>
          Answer with Sim
        </Button>
      </div>
      {showFilters && (
        <div className='flex flex-wrap gap-1.5 px-2 pb-1'>
          <Chip shape='round' active={sourceFilter === null} onClick={() => setSourceFilter(null)}>
            All sources
          </Chip>
          {sourceTypes.map((type) => (
            <Chip
              key={type}
              shape='round'
              active={sourceFilter === type}
              onClick={() => setSourceFilter(sourceFilter === type ? null : type)}
            >
              {type === 'upload' ? 'Uploads' : connectorName(type)}
            </Chip>
          ))}
          <span className='mx-1 self-center text-[var(--text-muted)] text-caption'>·</span>
          {UPDATED_WINDOWS.map((window) => (
            <Chip
              key={window.id}
              shape='round'
              active={updatedFilter === window.id}
              onClick={() => setUpdatedFilter(window.id)}
            >
              {window.label}
            </Chip>
          ))}
        </div>
      )}
      {visible.length === 0 ? (
        <p className='px-2 py-3 text-[var(--text-muted)] text-small'>
          {documents.length === 0
            ? `No documents you can read match “${query}”.`
            : 'No documents match these filters.'}
        </p>
      ) : (
        <div className='flex flex-col gap-0.5' onKeyDown={handleResultsKeyDown}>
          {visible.map((result) => {
            const source = toSource(result)
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
              <div key={result.documentId} className='flex flex-col gap-0.5 px-2 py-2'>
                <p className='truncate text-[var(--text-primary)] text-sm'>
                  {result.documentName ?? 'Untitled document'}
                </p>
                <p className='truncate text-[var(--text-muted)] text-caption'>
                  {result.knowledgeBaseName}
                </p>
                <p className='line-clamp-2 text-[var(--text-body)] text-small leading-snug'>
                  {toSnippet(result.content)}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
