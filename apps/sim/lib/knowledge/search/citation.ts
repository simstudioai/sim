import { sha256Hex } from '@sim/security/hash'
import type { ResourceScope } from '@/lib/core/resource-scope'

/** Stable opaque citation IDs keep the model from rewriting long live references. */
export function liveCitationId(documentId: string): string {
  return `live:${sha256Hex(documentId).slice(0, 32)}`
}

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

interface KnowledgeDocumentCitationInput {
  scope: ResourceScope
  knowledgeBaseId: string
  documentId: string
  sourceUrl: string | null
  baseUrl: string
}

/** Uses the original source when safe, otherwise the authorized Sim document page. */
export function createKnowledgeDocumentCitation(input: KnowledgeDocumentCitationInput) {
  if (!isKnowledgeSourceUrl(input.baseUrl)) throw new Error('Invalid citation base URL')
  const ownerPath =
    input.scope.kind === 'organization'
      ? `/o/${encodeURIComponent(input.scope.organizationId)}`
      : `/workspace/${encodeURIComponent(input.scope.workspaceId)}`
  const documentPath = `${ownerPath}/knowledge/${encodeURIComponent(input.knowledgeBaseId)}/${encodeURIComponent(input.documentId)}`
  const sourceUrl = input.sourceUrl?.trim()
  return {
    citationId: `document:${input.documentId}`,
    citationUrl:
      sourceUrl && isKnowledgeSourceUrl(sourceUrl)
        ? sourceUrl
        : new URL(documentPath, input.baseUrl).href,
  }
}
