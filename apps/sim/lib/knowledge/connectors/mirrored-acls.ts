import { EMPTY_ACL } from '@/lib/knowledge/access/tokens'
import type { MirroredDocumentAcl } from '@/lib/knowledge/access/types'
import type { ExternalDocument } from '@/connectors/types'

export interface MirroredAcls {
  /** Each listed document's ACL; unresolved entries are distinguished before persistence. */
  acls: Map<string, MirroredDocumentAcl>
  /** Listed documents neither the listing nor the fetch could speak for. */
  unresolvedExternalIds: ReadonlySet<string>
  unattributed: number
}

/** The listed documents whose ACL the listing left unset. */
export function unansweredByListing(externalDocs: readonly ExternalDocument[]): ExternalDocument[] {
  const answered = new Set(
    externalDocs.filter((doc) => doc.acl !== undefined).map((doc) => doc.externalId)
  )
  const requested = new Set<string>()
  return externalDocs.filter((doc) => {
    if (answered.has(doc.externalId) || requested.has(doc.externalId)) return false
    requested.add(doc.externalId)
    return true
  })
}

/**
 * One ACL per listed document, from the two places a connector may answer:
 * inline on the listing, or fetched afterwards for the ids the listing could
 * not describe.
 *
 * The listing's answer wins where it exists, because it is the cheaper one and
 * was taken from the same page the document came from. A document neither
 * answered for is marked unresolved. Persistence can retain another verified
 * observation from the same crawl, but must hide older, unverified grants.
 * Explicit answers, including empty or malformed ACLs, replace earlier answers.
 */
export function mergeMirroredAcls(
  externalDocs: readonly ExternalDocument[],
  fetched: Readonly<Record<string, MirroredDocumentAcl>>
): MirroredAcls {
  const acls = new Map<string, MirroredDocumentAcl>()
  const unresolvedExternalIds = new Set<string>()
  for (const doc of externalDocs) {
    if (doc.acl !== undefined) acls.set(doc.externalId, doc.acl)
  }
  for (const doc of externalDocs) {
    if (acls.has(doc.externalId)) continue
    const acl = fetched[doc.externalId]
    acls.set(doc.externalId, acl ?? EMPTY_ACL)
    if (acl === undefined) unresolvedExternalIds.add(doc.externalId)
  }
  return { acls, unresolvedExternalIds, unattributed: unresolvedExternalIds.size }
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
