import type { WorkspaceKnowledgeSearchResult } from '@/lib/api/contracts/knowledge'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { matchSnippet } from '@/lib/knowledge/search/snippet'
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

const KNOWLEDGE_DOCUMENT_PATH = /^\/(?:o|workspace)\/[^/]+\/knowledge\/([^/]+)\/([^/]+)\/?$/

/** Where Sim shows a knowledge document with no source link of its own. */
function knowledgeDocumentUrl(
  scope: ResourceScope,
  knowledgeBaseId: string,
  documentId: string
): string {
  const owner =
    scope.kind === 'organization'
      ? `/o/${encodeURIComponent(scope.organizationId)}`
      : `/workspace/${encodeURIComponent(scope.workspaceId)}`
  return `${getBaseUrl()}${owner}/knowledge/${encodeURIComponent(knowledgeBaseId)}/${encodeURIComponent(documentId)}`
}

/**
 * The knowledge document a cited Sim link names, as {@link toSource} builds one, or `null` for any
 * other link. A saved answer keeps citing a document after it is deleted (a personal index removed
 * when its owner joined a team, say), so a reader can check the document before linking to it.
 */
export function knowledgeDocumentLink(
  url: string
): { knowledgeBaseId: string; documentId: string } | null {
  try {
    const link = new URL(url)
    if (link.origin !== new URL(getBaseUrl()).origin) return null
    const match = KNOWLEDGE_DOCUMENT_PATH.exec(link.pathname)
    if (!match) return null
    return {
      knowledgeBaseId: decodeURIComponent(match[1]),
      documentId: decodeURIComponent(match[2]),
    }
  } catch {
    return null
  }
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
