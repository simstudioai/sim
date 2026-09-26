import { db } from '@sim/db'
import { knowledgeConnector, knowledgeConnectorMember } from '@sim/db/schema'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { SOURCE_ACL_MAX_AGE_MS } from '@/lib/knowledge/access/freshness'
import { textArrayLiteral } from '@/lib/knowledge/access/predicate'
import type { KnowledgeAccessScope } from '@/lib/knowledge/access/types'
import { searchIntegrationAccessCondition } from '@/lib/knowledge/search/integration-policy'

/**
 * The connectors a search may read from, resolved once per query: their ids grouped by the shape
 * their documents' ACLs take, and separately those whose reader access is proven live per request.
 */
export interface KnowledgeConnectorEligibility {
  /** Documents carry the workspace ACL. */
  workspace: readonly string[]
  /** Documents carry mirrored source permissions verified as a whole. */
  admin: readonly string[]
  /** Documents carry the subject tokens of the members who observe them. */
  members: readonly string[]
  /** Of the above, those that additionally require this request's live source proof. */
  liveProofRequired: readonly string[]
}

/** One of the caller's member identities and the connector it belongs to. */
export interface KnowledgeMemberObserver {
  id: string
  connectorId: string
}

/**
 * The caller's active member identities on the connectors a search reads, by what makes their
 * observations current: `confirmed` members drained their change feed inside the freshness window,
 * so every observation they hold stands; `observed` members are trusted only where the observation
 * itself is recent.
 */
export interface KnowledgeMemberObservers {
  confirmed: readonly KnowledgeMemberObserver[]
  observed: readonly KnowledgeMemberObserver[]
}

/** What a search resolves once about its sources and the caller's standing in them. */
export interface SearchAccessPlan {
  connectors: KnowledgeConnectorEligibility
  observers: KnowledgeMemberObservers
  /** Connectors the caller is an active member of, whose documents they read broadly. */
  memberSources: readonly string[]
  /** Each eligible connector's type, so a search may be confined to one kind of source. */
  connectorTypes: ReadonlyMap<string, string>
  /** Whether documents without a source — uploads — are in scope. */
  uploads: boolean
}

/**
 * The plan confined to one kind of source: the connectors of that type keep their eligibility and
 * the rest lose it, so every predicate built from the plan — on the row and on the document — and
 * every source the legs walk or rank are that kind alone. `upload` keeps only source-less documents.
 */
export function restrictSearchAccessPlan(plan: SearchAccessPlan, source: string): SearchAccessPlan {
  const keep = (id: string) => source !== 'upload' && plan.connectorTypes.get(id) === source
  const kept = (ids: readonly string[]) => ids.filter(keep)
  return {
    connectors: {
      workspace: kept(plan.connectors.workspace),
      admin: kept(plan.connectors.admin),
      members: kept(plan.connectors.members),
      liveProofRequired: kept(plan.connectors.liveProofRequired),
    },
    observers: {
      confirmed: plan.observers.confirmed.filter((observer) => keep(observer.connectorId)),
      observed: plan.observers.observed.filter((observer) => keep(observer.connectorId)),
    },
    memberSources: kept(plan.memberSources),
    connectorTypes: plan.connectorTypes,
    uploads: source === 'upload',
  }
}

/**
 * The connectors a search may read from, grouped by access mode, with the ones whose reader access
 * must be proven live marked.
 *
 * Deletion, archival, a pending access rewrite and the organization's integration approval are
 * facts about a connector. Resolving them once per query — there are tens of connectors against
 * hundreds of thousands of documents — leaves each candidate its own columns to check.
 */
async function resolveConnectorEligibility(
  knowledgeBaseIds: readonly string[]
): Promise<{ eligibility: KnowledgeConnectorEligibility; types: Map<string, string> }> {
  const eligibility: {
    workspace: string[]
    admin: string[]
    members: string[]
    liveProofRequired: string[]
  } = { workspace: [], admin: [], members: [], liveProofRequired: [] }
  const types = new Map<string, string>()
  if (knowledgeBaseIds.length === 0) return { eligibility, types }
  const rows = await db
    .select({
      id: knowledgeConnector.id,
      accessMode: knowledgeConnector.accessMode,
      connectorType: knowledgeConnector.connectorType,
      /** A GitHub connector is gated only where it names the immutable repository behind a grant. */
      githubRepository: sql<boolean>`${knowledgeConnector.sourceConfig}::jsonb ? 'githubRepositoryId'`,
    })
    .from(knowledgeConnector)
    .where(
      and(
        inArray(knowledgeConnector.knowledgeBaseId, [...knowledgeBaseIds]),
        isNull(knowledgeConnector.deletedAt),
        isNull(knowledgeConnector.archivedAt),
        eq(knowledgeConnector.accessRewritePending, false),
        searchIntegrationAccessCondition()
      )
    )
  for (const row of rows) {
    if (row.accessMode === 'workspace') eligibility.workspace.push(row.id)
    else if (row.accessMode === 'admin') eligibility.admin.push(row.id)
    else if (row.accessMode === 'members') eligibility.members.push(row.id)
    else continue
    types.set(row.id, row.connectorType)
    const live =
      (row.connectorType === 'github' && row.githubRepository) ||
      (row.connectorType === 'confluence' && row.accessMode === 'admin')
    if (live) eligibility.liveProofRequired.push(row.id)
  }
  return { eligibility, types }
}

/**
 * The caller's own member identities on these connectors, split by whether the member's change
 * feed is itself current.
 *
 * A members-mode document is readable while one of the caller's active members observes it,
 * freshly — and which members those are is a fact about the caller, not about any document. A
 * member whose feed drained recently confirms every observation it holds, so its observations need
 * no age check at all; the rest are checked against the age of the observation itself. Resolved
 * once, the per-document check becomes one lookup on the observation key, with no join to the
 * member behind it.
 */
async function resolveMemberObservers(
  access: KnowledgeAccessScope,
  connectorIds: readonly string[]
): Promise<{ observers: KnowledgeMemberObservers; memberSources: string[] }> {
  if (access.kind !== 'user' || connectorIds.length === 0 || access.tokens.length === 0) {
    return { observers: { confirmed: [], observed: [] }, memberSources: [] }
  }
  const rows = await db
    .select({
      id: knowledgeConnectorMember.id,
      connectorId: knowledgeConnectorMember.connectorId,
      syncedThrough: knowledgeConnectorMember.memberSyncedThrough,
    })
    .from(knowledgeConnectorMember)
    .where(
      and(
        inArray(knowledgeConnectorMember.connectorId, [...connectorIds]),
        eq(knowledgeConnectorMember.status, 'active'),
        sql`${knowledgeConnectorMember.subjectToken} = ANY(${textArrayLiteral([...access.tokens])})`
      )
    )
  const cutoff = Date.now() - SOURCE_ACL_MAX_AGE_MS
  const confirmed: KnowledgeMemberObserver[] = []
  const observed: KnowledgeMemberObserver[] = []
  const memberSources = new Set<string>()
  for (const row of rows) {
    const member = { id: row.id, connectorId: row.connectorId }
    if (row.syncedThrough !== null && row.syncedThrough.getTime() > cutoff) confirmed.push(member)
    else observed.push(member)
    memberSources.add(row.connectorId)
  }
  return { observers: { confirmed, observed }, memberSources: [...memberSources] }
}

/**
 * Everything a search needs to know about its sources and the caller's standing in them, resolved
 * once: which connectors it may read, the caller's member identities there, and the sources they
 * are a member of. Each is a fact about a connector or a caller, so deriving them per candidate
 * document is what made retrieval cost grow with the size of what someone may read.
 */
export async function resolveSearchAccessPlan(
  knowledgeBaseIds: readonly string[],
  access: KnowledgeAccessScope
): Promise<SearchAccessPlan> {
  const { eligibility: connectors, types: connectorTypes } =
    await resolveConnectorEligibility(knowledgeBaseIds)
  const { observers, memberSources } = await resolveMemberObservers(access, connectors.members)
  return { connectors, observers, memberSources, connectorTypes, uploads: true }
}
