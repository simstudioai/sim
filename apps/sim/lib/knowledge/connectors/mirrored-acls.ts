import { EMPTY_ACL } from '@/lib/knowledge/access/tokens'
import type { ExternalDocument } from '@/connectors/types'

export interface MirroredAcls {
  /** Every listed document's ACL, keyed by external id; readable by nobody where neither source answered. */
  acls: Map<string, readonly string[]>
  /** Listed documents neither the listing nor the fetch could speak for. */
  unattributed: number
}

/** The external ids of listed documents whose ACL the listing left unset. */
export function unansweredByListing(externalDocs: readonly ExternalDocument[]): string[] {
  return externalDocs.filter((doc) => !doc.acl).map((doc) => doc.externalId)
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
  fetched: Readonly<Record<string, readonly string[]>>
): MirroredAcls {
  const acls = new Map<string, readonly string[]>()
  let unattributed = 0
  for (const doc of externalDocs) {
    const acl = doc.acl ?? fetched[doc.externalId]
    if (!acl) unattributed += 1
    acls.set(doc.externalId, acl ?? EMPTY_ACL)
  }
  return { acls, unattributed }
}
