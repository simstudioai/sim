import { sha256Hex } from '@sim/security/hash'

/** Stable opaque citation IDs keep the model from rewriting long live references. */
export function liveCitationId(documentId: string): string {
  return `live:${sha256Hex(documentId).slice(0, 32)}`
}
