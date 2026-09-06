import { EMPTY_ACL } from '@/lib/knowledge/access/tokens'
import type { MirroredDocumentAcl } from '@/lib/knowledge/access/types'
import type { ExternalDocument } from '@/connectors/types'

export interface MirroredAcls {
  /** Every listed document's ACL, keyed by external id; readable by nobody where neither source answered. */
  acls: Map<string, MirroredDocumentAcl>
  /** Listed documents neither the listing nor the fetch could speak for. */
  unattributed: number
}

/** The listed documents whose ACL the listing left unset. */
export function unansweredByListing(externalDocs: readonly ExternalDocument[]): ExternalDocument[] {
  return externalDocs.filter((doc) => !doc.acl)
}

/**
 * One ACL per listed document, from the two places a connector may answer:
 * inline on the listing, or fetched afterwards for the ids the listing could
 * not describe.
 *
 * The listing's answer wins where it exists, because it is the cheaper one and
 * was taken from the same page the document came from. A document neither
 * answered for is readable by nobody rather than skipped — leaving its previous
 * ACL in place would keep serving it under permissions this run failed to
 * verify — and is counted, because a connector that declares it mirrors ACLs is
 * promising an answer for everything it lists.
 */
export function mergeMirroredAcls(
  externalDocs: readonly ExternalDocument[],
  fetched: Readonly<Record<string, MirroredDocumentAcl>>
): MirroredAcls {
  const acls = new Map<string, MirroredDocumentAcl>()
  let unattributed = 0
  for (const doc of externalDocs) {
    const acl = doc.acl ?? fetched[doc.externalId]
    if (!acl) unattributed += 1
    acls.set(doc.externalId, acl ?? EMPTY_ACL)
  }
  return { acls, unattributed }
}

/**
 * Hides every owned document the listing did not name, and returns how many.
 *
 * The listing is the only evidence this run has of who may read what; a
 * document absent from it keeps no ACL this run can vouch for.
 */
export function hideUnlistedDocuments(
  acls: Map<string, MirroredDocumentAcl>,
  ownedExternalIds: readonly (string | null)[]
): number {
  let hidden = 0
  for (const externalId of ownedExternalIds) {
    if (!externalId || acls.has(externalId)) continue
    acls.set(externalId, EMPTY_ACL)
    hidden += 1
  }
  return hidden
}
