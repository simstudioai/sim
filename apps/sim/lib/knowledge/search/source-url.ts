import type { ResourceScope } from '@/lib/core/resource-scope'
import { getBaseUrl } from '@/lib/core/utils/urls'

/** Accepts navigable provider links without embedding credentials or rewriting their identity. */
export function isKnowledgeSourceUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

const KNOWLEDGE_DOCUMENT_PATH = /^\/(?:o|workspace)\/[^/]+\/knowledge\/([^/]+)\/([^/]+)\/?$/

/** Where Sim shows a knowledge document with no source link of its own. */
export function knowledgeDocumentUrl(
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
 * The knowledge document a cited Sim link names, as {@link knowledgeDocumentUrl} builds one, or
 * `null` for any other link. A saved answer keeps citing a document after it is deleted (a personal
 * index removed when its owner joined a team, say), so a reader can check it before linking to it.
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
