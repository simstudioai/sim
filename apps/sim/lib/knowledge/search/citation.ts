import { sha256Hex } from '@sim/security/hash'
import { liveDocumentKey } from '@/lib/sim-search/live/reference'

/**
 * Stable opaque citation IDs keep the model from rewriting long live references. The hash covers
 * the document's identity rather than the ID's spelling, so an earlier-form ID and a current one
 * for the same document cite as one source. Saved chats keep the citation IDs their tool results
 * stored, so changing what is hashed never strands an existing citation.
 */
export function liveCitationId(documentId: string): string {
  return `live:${sha256Hex(liveDocumentKey(documentId)).slice(0, 32)}`
}
