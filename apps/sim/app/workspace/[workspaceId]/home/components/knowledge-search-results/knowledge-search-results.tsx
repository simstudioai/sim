'use client'

import { useMemo } from 'react'
import type { WorkspaceKnowledgeSearchResult } from '@/lib/api/contracts/knowledge'
import { SourceCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { useKnowledgeBasesQuery, useWorkspaceKnowledgeSearch } from '@/hooks/queries/kb/knowledge'

/** A search spans at most this many knowledge bases. */
const MAX_SEARCHED_KNOWLEDGE_BASES = 20
/** Characters of the matching chunk shown under a result. */
const SNIPPET_LENGTH = 280

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

/** A result as the source card renders it; a document without a source URL cannot be opened. */
function toSource(result: WorkspaceKnowledgeSearchResult): SourceTagData | null {
  if (!result.sourceUrl) return null
  return {
    url: result.sourceUrl,
    title: result.documentName ?? undefined,
    siteName: result.knowledgeBaseName || undefined,
    connectorType: result.connectorType ?? undefined,
    snippet: toSnippet(result.content),
    updatedAt: result.sourceModifiedAt ?? undefined,
  }
}

interface KnowledgeSearchResultsProps {
  workspaceId: string
  query: string
  /** Asks the agent about one document; the prompt names it and links to it. */
  onSummarize: (prompt: string) => void
}

/**
 * The composer's Search mode: the documents the signed-in person may read that
 * match their query, across every knowledge base in the workspace, as cards
 * that open the source. Summarize hands one document to the agent.
 */
export function KnowledgeSearchResults({
  workspaceId,
  query,
  onSummarize,
}: KnowledgeSearchResultsProps) {
  const { data: knowledgeBases = [], isPending: basesPending } = useKnowledgeBasesQuery(workspaceId)
  const knowledgeBaseIds = useMemo(
    () => knowledgeBases.slice(0, MAX_SEARCHED_KNOWLEDGE_BASES).map((kb) => kb.id),
    [knowledgeBases]
  )
  const {
    data: results,
    isPending,
    isFetching,
    error,
  } = useWorkspaceKnowledgeSearch(workspaceId, knowledgeBaseIds, query)
  const documents = useMemo(() => groupResultsByDocument(results ?? []), [results])

  if (!basesPending && knowledgeBaseIds.length === 0) {
    return (
      <p className='px-2 py-3 text-[var(--text-muted)] text-small'>
        No knowledge bases to search yet. Add one from the Knowledge tab.
      </p>
    )
  }
  if (error) {
    return <p className='px-2 py-3 text-[var(--text-error)] text-small'>{error.message}</p>
  }
  if (isPending || (isFetching && !results)) {
    return <p className='px-2 py-3 text-[var(--text-muted)] text-small'>Searching…</p>
  }
  if (documents.length === 0) {
    return (
      <p className='px-2 py-3 text-[var(--text-muted)] text-small'>
        No documents you can read match “{query}”.
      </p>
    )
  }

  return (
    <div className='flex flex-col gap-0.5'>
      {documents.map((result) => {
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
  )
}
