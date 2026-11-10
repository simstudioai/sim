import type { WorkspaceKnowledgeSearchResult } from '@/lib/api/contracts/knowledge'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { matchSnippet } from '@/lib/knowledge/search/snippet'
import { knowledgeDocumentUrl } from '@/lib/knowledge/search/source-url'
import { isHttpUrl, type SourceTagData } from '@/lib/mothership/chat/special-tags'
import { connectorDisplayName } from '@/lib/sim-search/connectors'

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
 * URL, the link opens the canonical document in Sim, which only a workspace's
 * knowledge base has; an organization's search index has no document page, so
 * its result has no link.
 */
export function toSource(
  result: WorkspaceKnowledgeSearchResult,
  query: string,
  scope: ResourceScope
): Omit<SourceTagData, 'url'> & { url?: string } {
  return {
    url: isHttpUrl(result.sourceUrl)
      ? result.sourceUrl
      : knowledgeDocumentUrl(scope, result.knowledgeBaseId, result.documentId),
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
