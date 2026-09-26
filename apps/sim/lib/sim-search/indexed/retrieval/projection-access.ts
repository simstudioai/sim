import {
  document,
  knowledgeConnector,
  knowledgeDocumentObservation,
  knowledgeProjectionDirty,
} from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  aclOverlap,
  aclRequirementsSatisfied,
  documentHasMirroredAcl,
  documentHasWorkspaceAcl,
  sourceAclFreshnessCutoff,
  textArrayLiteral,
} from '@/lib/knowledge/access/predicate'
import type { UserAccessScope } from '@/lib/knowledge/access/types'
import type {
  KnowledgeMemberObserver,
  KnowledgeMemberObservers,
  SearchAccessPlan,
} from '@/lib/sim-search/indexed/retrieval/access-plan'

/**
 * The candidate predicate with connector state resolved ahead of the query instead of per row.
 *
 * Deletion, archival, a pending access rewrite, the organization's integration approval and the
 * access mode are facts about a connector, not a document, so checking them once per query leaves
 * each candidate an id comparison plus its own columns.
 *
 * `liveSourceAccess` is the caller's live source proof, and defaults to admitting everything:
 * candidate ranking defers that proof until after ranking, exactly as
 * `knowledgeMetadataCandidateAccessCondition` does, and only a reader that already holds the
 * grants — content hydration — passes it. The connectors it would gate are listed separately so
 * that clause is applied to those alone.
 *
 * Either way it narrows exactly as the predicate it stands in for: the eligible ids are the
 * connectors that predicate's `EXISTS` would admit, and every document-level clause is carried
 * over unchanged.
 */
export function knowledgeCandidateAccessConditionForConnectors(
  scope: UserAccessScope,
  plan: SearchAccessPlan,
  liveSourceAccess: SQL = sql`true`
): SQL {
  const eligibility = plan.connectors
  if (scope.tokens.length === 0) return sql`false`
  const tokens = textArrayLiteral(scope.tokens)
  const cutoff = sourceAclFreshnessCutoff()
  const liveProof = new Set(eligibility.liveProofRequired)
  const inConnectors = (ids: readonly string[]): SQL =>
    ids.length === 0
      ? sql`false`
      : sql`${document.connectorId} = ANY(${textArrayLiteral([...ids])})`
  const mirrored = (ids: readonly string[], current: SQL): SQL => {
    const direct = ids.filter((id) => !liveProof.has(id))
    const gated = ids.filter((id) => liveProof.has(id))
    const currentAndMirrored = sql`${documentHasMirroredAcl()} AND ${current}`
    return sql`(
      (${inConnectors(direct)} AND ${currentAndMirrored})
      OR (${inConnectors(gated)} AND ${currentAndMirrored} AND EXISTS (
        SELECT 1 FROM ${knowledgeConnector}
        WHERE ${knowledgeConnector.id} = ${document.connectorId}
          AND ${liveSourceAccess}
      ))
    )`
  }
  const workspaceOwned = plan.uploads
    ? sql`(${document.connectorId} IS NULL OR ${inConnectors(eligibility.workspace)})`
    : inConnectors(eligibility.workspace)
  return sql`(
    ${aclOverlap(tokens)}
    AND ${aclRequirementsSatisfied(tokens)}
    AND (
      (${workspaceOwned} AND ${documentHasWorkspaceAcl()})
      OR ${mirrored(eligibility.admin, sql`${document.aclVerifiedAt} > ${cutoff}`)}
      OR ${mirrored(eligibility.members, resolvedObservationCondition(plan.observers, cutoff))}
    )
  )`
}

/**
 * Whether a projection row belongs to a document marked for the knowledge projector: its source,
 * ACL, or chunks changed and its rows may not show it yet. A probe of the marks' primary key: the
 * planner may instead hash the whole set once per statement, which is as cheap while the marks are
 * few, and an `IN` would risk re-reading them per row once they outgrow the hash.
 */
export function projectionPending(documentId: AnyPgColumn | SQL): SQL {
  return sql`(EXISTS (SELECT 1 FROM ${knowledgeProjectionDirty} WHERE ${knowledgeProjectionDirty.documentId} = ${documentId}))`
}

/**
 * Whether a projection row is decided on its document rather than on its own columns: its
 * document is marked for the projector, or, while the source and ACL fill runs, the row has not
 * been filled.
 */
export function projectionDecidedOnDocument(
  projection: { acl: AnyPgColumn | SQL; documentId: AnyPgColumn | SQL },
  filled: boolean
): SQL {
  const pending = projectionPending(projection.documentId)
  return filled ? pending : sql`(${projection.acl} IS NULL OR ${pending})`
}

/**
 * The candidate predicate on a ranking projection's own row, for a scope whose connectors were
 * resolved: `connectorId` and `acl` are mirrored there from the document, so a walk or a keyword
 * window decides readability on the row it scores instead of joining `document` per candidate.
 *
 * It admits a superset of the document predicate, never a subset: a mirrored ACL names the members
 * who observe a document, so overlap with the caller's tokens is the per-row test without the
 * observation's freshness, and requirement clauses live on the document. Both are refused there,
 * under the full predicate, before content is returned — this predicate only decides what is worth
 * ranking.
 *
 * A row whose columns may be behind its document is decided on the document instead, under
 * {@link knowledgeCandidateAccessConditionForConnectors} — the join per candidate that every row
 * paid before the columns existed: a row the source and ACL fill has not reached (`acl IS NULL`),
 * and every row of a document marked for the knowledge projector. A revoked grant still on such a
 * row never admits it, and a new grant not yet on it never hides it from a statement that reaches
 * the row. A source-scoped walk or slice reaches rows by the source on the row, though, so a
 * document that moved to another source joins that source's ranking once the projector has
 * rewritten its rows; until then it can be missing there, never shown where it is not readable.
 * The projector and the fill run in the background, so search never waits on either.
 */
export function projectionCandidateAccessCondition(
  projection: {
    connectorId: AnyPgColumn | SQL
    acl: AnyPgColumn | SQL
    documentId: AnyPgColumn | SQL
  },
  scope: UserAccessScope,
  plan: SearchAccessPlan,
  options: {
    /**
     * Whether every row of the projection carries its mirrored source and ACL. While the fill
     * is under way, a row it has not reached is decided on its document; once it is complete only
     * a marked document's rows are.
     */
    filled?: boolean
  } = {}
): SQL {
  if (scope.tokens.length === 0) return sql`false`
  const tokens = textArrayLiteral(scope.tokens)
  const inSources = (ids: readonly string[]): SQL =>
    ids.length === 0
      ? sql`false`
      : sql`${projection.connectorId} = ANY(${textArrayLiteral([...ids])})`
  const mirrored = [
    ...plan.connectors.workspace,
    ...plan.connectors.admin,
    ...plan.connectors.members,
  ]
  const owned = plan.uploads
    ? sql`(${projection.connectorId} IS NULL OR ${inSources(mirrored)})`
    : inSources(mirrored)
  const onRow = sql`(${projection.acl} && ${tokens} AND ${owned})`
  /**
   * A scalar subquery rather than `EXISTS`: the planner may turn an `EXISTS` into one hash of every
   * readable document, a sequential scan of `document` for a statement that only needs a few rows
   * decided. A scalar subquery is only ever a primary-key probe per row that needs it.
   */
  const onDocument = sql`(SELECT ${document.id} FROM ${document}
    WHERE ${document.id} = ${projection.documentId}
      AND ${knowledgeCandidateAccessConditionForConnectors(scope, plan)}
    LIMIT 1) IS NOT NULL`
  return sql`((${projectionDecidedOnDocument(projection, options.filled ?? false)} AND ${onDocument})
    OR (${onRow} AND NOT ${projectionPending(projection.documentId)}))`
}

/**
 * The same membership, resolved ahead of the query: each candidate costs one lookup on the
 * observation key instead of a join to the member behind it. Equivalent by construction — the ids
 * are the members that join would have matched, and each one's freshness rule is carried over.
 */
function resolvedObservationCondition(observers: KnowledgeMemberObservers, cutoff: SQL): SQL {
  if (observers.confirmed.length === 0 && observers.observed.length === 0) return sql`false`
  /**
   * An observation vouches for a document only from a member of the document's own connector: a
   * document that changed hands keeps its old observations, which must not carry it.
   */
  const byMember = (members: readonly KnowledgeMemberObserver[]): SQL =>
    sql`(${knowledgeDocumentObservation.memberId}, ${document.connectorId}) IN (${sql.join(
      members.map((member) => sql`(${member.id}, ${member.connectorId})`),
      sql`, `
    )})`
  const current =
    observers.confirmed.length === 0
      ? sql`${byMember(observers.observed)} AND ${knowledgeDocumentObservation.lastSeenAt} > ${cutoff}`
      : observers.observed.length === 0
        ? byMember(observers.confirmed)
        : sql`(${byMember(observers.confirmed)}
            OR (${byMember(observers.observed)} AND ${knowledgeDocumentObservation.lastSeenAt} > ${cutoff}))`
  return sql`EXISTS (
    SELECT 1 FROM ${knowledgeDocumentObservation}
    WHERE ${knowledgeDocumentObservation.documentId} = ${document.id}
      AND ${current}
  )`
}

/**
 * The token half of the stored access predicate: the documents a caller's tokens reach before
 * any source, freshness, or requirement check narrows them. It is a necessary condition of
 * `knowledgeAccessCondition`, never a substitute for it.
 *
 * Paired with `deleted_at IS NULL` it matches `doc_acl_gin_idx` exactly, so a query can enumerate
 * a member's reachable documents from that index alone. PostgreSQL cannot estimate array-overlap
 * selectivity, so left to itself it intersects this highly selective bitmap with base-wide ones.
 */
export function knowledgeAclOverlapCondition(scope: UserAccessScope): SQL {
  if (scope.tokens.length === 0) return sql`false`
  return aclOverlap(textArrayLiteral(scope.tokens))
}

/**
 * Keeps the rows of sources the caller turned out not to hold out of a ranking decided on the
 * row. A row decided on its document — not yet filled, or its document marked for the projector,
 * so its own source may be stale — asks the document instead.
 */
export function excludeSearchSourcesOnRow(
  projection: {
    connectorId: AnyPgColumn | SQL
    acl: AnyPgColumn | SQL
    documentId: AnyPgColumn | SQL
  },
  filled: boolean,
  excludedSources: readonly string[]
): SQL | undefined {
  if (!excludedSources.length) return undefined
  const excluded = textArrayLiteral([...excludedSources])
  const decided = projectionDecidedOnDocument(projection, filled)
  return sql`((${decided} AND NOT EXISTS (SELECT 1 FROM ${document} WHERE ${document.id} = ${projection.documentId} AND ${document.connectorId} = ANY(${excluded})))
    OR (NOT ${decided} AND (${projection.connectorId} IS NULL OR NOT (${projection.connectorId} = ANY(${excluded}))))) /* excluded sources */`
}
