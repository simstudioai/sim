import type {
  WorkspaceKnowledgeSearchResult,
  WorkspaceSearchFilters,
} from '@/lib/api/contracts/knowledge'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { matchSnippet } from '@/lib/knowledge/search/snippet'
import type { SearchResource } from '@/lib/mothership/generated/resources'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import {
  isHttpUrl,
  type SourceTagData,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'

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
export function toSource(
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
    updatedAt: result.sourceDate ?? result.sourceModifiedAt ?? undefined,
  }
}

/**
 * Arrow keys walk the result links, the way a search page does; Enter on a
 * focused link opens it natively. Focus stops at either end.
 */
export function handleResultsKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
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

/** What each backend's results view is handed by `KnowledgeSearchResults`. */
export interface SearchResultsProps {
  suppliedFilters?: WorkspaceSearchFilters
  topK?: number
  nativeQueries?: SearchResource['nativeQueries']
  reuseFreshResult?: boolean
  scope: ResourceScope
  query: string
  /** Binds the Assistant turn to the selected canonical document. */
  onSummarize: (prompt: string, filters: WorkspaceSearchFilters) => void
  onSearchChange?: (search: SearchResource) => void
}
