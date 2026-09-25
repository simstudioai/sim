import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
  knowledgeProjectionDirty,
  member,
  user,
} from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { EXTERNAL_GROUP_STALE_AFTER_MS } from '@/lib/knowledge/access/external-groups'
import { SOURCE_ACL_MAX_AGE_MS } from '@/lib/knowledge/access/freshness'
import { confluenceReaderGroupCondition } from '@/lib/knowledge/access/group-membership'
import type { KnowledgeAccessScope, SystemAccessScope } from '@/lib/knowledge/access/types'
import { documentConnectorIsActive } from '@/lib/knowledge/documents/connector-lifecycle'
import { searchIntegrationAccessCondition } from '@/lib/knowledge/search/integration-policy'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import { ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

/** Every Confluence clause must match the same confirmed reader, including that reader's groups. */
function confluenceReaderClause(hasToken: (token: SQL) => SQL): SQL {
  const groups = confluenceReaderGroupCondition({
    readerSubjectToken: sql`confluence_read_grant.reader_subject_token`,
    cloudId: sql`confluence_read_grant.cloud_id`,
    organizationId: sql`${knowledgeBase.organizationId}`,
    workspaceId: sql`${knowledgeBase.workspaceId}`,
    freshEnough: sql`statement_timestamp() - (${EXTERNAL_GROUP_STALE_AFTER_MS} * interval '1 millisecond')`,
    hasToken,
  })
  return sql`(${hasToken(sql`confluence_read_grant.reader_subject_token`)} OR ${groups})`
}

/** A cached space grant cannot substitute for the reader's current Confluence site access. */
function confluenceSiteAccessCondition(scope: KnowledgeAccessScope): SQL {
  const grants = scope.kind === 'user' ? (scope.confluenceSiteGrants ?? []) : []
  const allowed =
    scope.kind !== 'user' || grants.length === 0
      ? sql`false`
      : sql`EXISTS (
    SELECT 1 FROM (VALUES ${sql.join(
      grants.map(
        (grant) => sql`(
      ${grant.connectorId}, ${grant.contentCredentialId}, ${grant.readerCredentialId}, ${grant.readerSubjectToken}, ${grant.domain}, ${grant.cloudId}
    )`
      ),
      sql`, `
    )}) AS confluence_read_grant(connector_id, content_credential_id, reader_credential_id, reader_subject_token, domain, cloud_id)
    JOIN ${knowledgeBase} ON ${knowledgeBase.id} = ${knowledgeConnector.knowledgeBaseId}
    JOIN ${credential} ON ${credential.id} = confluence_read_grant.content_credential_id
    WHERE confluence_read_grant.connector_id = ${knowledgeConnector.id}
      AND confluence_read_grant.content_credential_id = ${knowledgeConnector.credentialId}
      AND confluence_read_grant.domain = ${knowledgeConnector.sourceConfig}->>'domain'
      AND ${confluenceReaderClause((token) => sql`${token} = ANY(${document.acl})`)}
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(${document.aclRequirements}) AS confluence_required_clause(tokens)
        WHERE NOT ${confluenceReaderClause((token) => sql`confluence_required_clause.tokens ? ${token}`)}
      )
      AND ${knowledgeConnector.archivedAt} IS NULL AND ${knowledgeConnector.deletedAt} IS NULL
      AND ${knowledgeBase.deletedAt} IS NULL
      AND ${credential.type} = 'service_account'
      AND ${credential.providerId} = ${ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID}
      AND ${credential.revokedAt} IS NULL
      AND ${credential.organizationId} IS NOT DISTINCT FROM ${knowledgeBase.organizationId}
      AND ${credential.workspaceId} IS NOT DISTINCT FROM ${knowledgeBase.workspaceId}
      AND (${knowledgeBase.organizationId} IS NULL OR EXISTS (
        SELECT 1 FROM ${member} WHERE ${member.organizationId} = ${knowledgeBase.organizationId}
          AND ${member.userId} = ${scope.userId}
      ))
      AND EXISTS (
        SELECT 1 FROM ${credential}
        JOIN ${credentialGroupEnrollment} ON ${credentialGroupEnrollment.id} = ${credential.credentialGroupEnrollmentId}
        JOIN ${credentialGroup} ON ${credentialGroup.id} = ${credentialGroupEnrollment.credentialGroupId}
        JOIN ${user} ON ${user.id} = ${scope.userId}
        WHERE ${credential.id} = confluence_read_grant.reader_credential_id
          AND ${credential.type} = 'managed_oauth' AND ${credential.providerId} = 'confluence'
          AND ${credential.managedOauthStatus} = 'active' AND ${credential.revokedAt} IS NULL
          AND ('s:confluence:' || COALESCE(NULLIF(${credential.providerTenantId}, ''), '-') || ':' || ${credential.providerSubjectId}) = confluence_read_grant.reader_subject_token
          AND ${credential.organizationId} IS NOT DISTINCT FROM ${knowledgeBase.organizationId}
          AND ${credential.workspaceId} IS NOT DISTINCT FROM ${knowledgeBase.workspaceId}
          AND ${credentialGroup.organizationId} IS NOT DISTINCT FROM ${knowledgeBase.organizationId}
          AND ${credentialGroup.workspaceId} IS NOT DISTINCT FROM ${knowledgeBase.workspaceId}
          AND ${credentialGroup.status} = 'active'
          AND ${credentialGroupEnrollment.status} IN ('in_progress', 'completed')
          AND ${credentialGroupEnrollment.revokedAt} IS NULL
          AND ${user.emailVerified} = true
          AND ((${knowledgeBase.organizationId} IS NOT NULL AND ${credentialGroupEnrollment.userId} = ${scope.userId})
            OR (${knowledgeBase.workspaceId} IS NOT NULL AND ${credentialGroupEnrollment.email} = lower(btrim(${user.email}))))
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(${credentialGroup.options}) AS option
            WHERE option->>'id' = ${credential.credentialGroupOptionId} AND option->>'status' = 'active')
      )
  )`
  return sql`(${knowledgeConnector.connectorType} IS DISTINCT FROM 'confluence'
    OR ${knowledgeConnector.accessMode} <> 'admin' OR ${allowed})`
}

/** Missing credentials or missing live evidence must never downgrade an installation source. */
function githubInstallationAccessCondition(scope: KnowledgeAccessScope): SQL {
  const grants = scope.kind === 'user' ? (scope.githubInstallationGrants ?? []) : []
  const allowed =
    scope.kind !== 'user' || grants.length === 0
      ? sql`false`
      : sql`EXISTS (
    SELECT 1 FROM (VALUES ${sql.join(
      grants.map(
        (grant) => sql`(
      ${grant.connectorId}, ${grant.contentCredentialId}, ${grant.readerCredentialId}, ${grant.repositoryId}, ${grant.readerSubjectToken}
    )`
      ),
      sql`, `
    )}) AS github_read_grant(connector_id, content_credential_id, reader_credential_id, repository_id, reader_subject_token)
    JOIN ${credential} ON ${credential.id} = github_read_grant.content_credential_id
    JOIN ${knowledgeBase} ON ${knowledgeBase.id} = ${knowledgeConnector.knowledgeBaseId}
    WHERE github_read_grant.connector_id = ${knowledgeConnector.id}
      AND github_read_grant.content_credential_id = ${knowledgeConnector.credentialId}
      AND github_read_grant.repository_id = ${knowledgeConnector.sourceConfig}->>'githubRepositoryId'
      AND ${knowledgeConnector.accessMode} = 'members'
      AND ${knowledgeConnector.archivedAt} IS NULL AND ${knowledgeConnector.deletedAt} IS NULL
      AND ${knowledgeBase.deletedAt} IS NULL
      AND ${credential.type} = 'service_account'
      AND ${credential.providerId} = ${GITHUB_INSTALLATION_PROVIDER_ID}
      AND ${credential.revokedAt} IS NULL
      AND ${credential.organizationId} IS NOT DISTINCT FROM ${knowledgeBase.organizationId}
      AND ${credential.workspaceId} IS NOT DISTINCT FROM ${knowledgeBase.workspaceId}
      AND (${knowledgeBase.organizationId} IS NULL OR EXISTS (
        SELECT 1 FROM ${member} WHERE ${member.organizationId} = ${knowledgeBase.organizationId}
          AND ${member.userId} = ${scope.userId}
      ))
      AND EXISTS (
        SELECT 1 FROM ${credential}
        JOIN ${credentialGroupEnrollment} ON ${credentialGroupEnrollment.id} = ${credential.credentialGroupEnrollmentId}
        JOIN ${credentialGroup} ON ${credentialGroup.id} = ${credentialGroupEnrollment.credentialGroupId}
        JOIN ${user} ON ${user.id} = ${scope.userId}
        WHERE ${credential.id} = github_read_grant.reader_credential_id
          AND ${credential.type} = 'managed_oauth' AND ${credential.providerId} = 'github-repositories'
          AND ${credential.managedOauthStatus} = 'active' AND ${credential.revokedAt} IS NULL
          AND ('s:github-repositories:' || COALESCE(NULLIF(${credential.providerTenantId}, ''), '-') || ':' || ${credential.providerSubjectId}) = github_read_grant.reader_subject_token
          AND ${credential.organizationId} IS NOT DISTINCT FROM ${knowledgeBase.organizationId}
          AND ${credential.workspaceId} IS NOT DISTINCT FROM ${knowledgeBase.workspaceId}
          AND ${credentialGroup.organizationId} IS NOT DISTINCT FROM ${knowledgeBase.organizationId}
          AND ${credentialGroup.workspaceId} IS NOT DISTINCT FROM ${knowledgeBase.workspaceId}
          AND ${credentialGroup.status} = 'active'
          AND ${credentialGroup.id} = ${knowledgeConnector.credentialGroupId}
          AND ${credential.credentialGroupOptionId} = ${knowledgeConnector.credentialGroupOptionId}
          AND ${credentialGroupEnrollment.status} IN ('in_progress', 'completed')
          AND ${credentialGroupEnrollment.revokedAt} IS NULL
          AND ${user.emailVerified} = true
          AND ((${knowledgeBase.organizationId} IS NOT NULL AND ${credentialGroupEnrollment.userId} = ${scope.userId})
            OR (${knowledgeBase.workspaceId} IS NOT NULL AND ${credentialGroupEnrollment.email} = lower(btrim(${user.email}))))
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(${credentialGroup.options}) AS option
            WHERE option->>'id' = ${credential.credentialGroupOptionId} AND option->>'status' = 'active')
      )
  )`
  return sql`(
    ${knowledgeConnector.connectorType} IS DISTINCT FROM 'github'
    OR (NOT (${knowledgeConnector.sourceConfig}::jsonb ? 'githubRepositoryId') AND NOT EXISTS (
      SELECT 1 FROM ${credential} WHERE ${credential.id} = ${knowledgeConnector.credentialId}
        AND ${credential.providerId} = ${GITHUB_INSTALLATION_PROVIDER_ID}
    ))
    OR ${allowed}
  )`
}

/**
 * The single read-side access predicate: the document's ACL overlaps the
 * caller's token set. Small token sets use literal arrays for GIN planning;
 * large directories use one JSON parameter to avoid PostgreSQL's bind limit.
 *
 * Additional clauses preserve source intersections. Source-derived grants also
 * require recent evidence, independent of scheduler health. A drained member
 * change feed confirms unchanged observations through `memberSyncedThrough`;
 * partial listings confirm only the documents actually observed.
 */
export function knowledgeAccessCondition(scope: KnowledgeAccessScope | SystemAccessScope): SQL {
  return storedKnowledgeAccessCondition(
    scope,
    scope.kind === 'system' ? sql`true` : liveSourceAccessCondition(scope)
  )
}

/**
 * Stored access for fixed identifier/rank candidate projections only. Candidate identities
 * must pass live source authorization and knowledgeAccessCondition before content, names,
 * tags, counts, provenance, or model input are selected or returned.
 */
export function knowledgeMetadataCandidateAccessCondition(
  scope: KnowledgeAccessScope | SystemAccessScope
): SQL {
  return storedKnowledgeAccessCondition(scope, sql`true`)
}

/** Every requirement clause must reach the caller, which preserves source permission intersections. */
function aclRequirementsSatisfied(tokens: SQL): SQL {
  return sql`NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(${document.aclRequirements}) AS required_clause(tokens)
      WHERE NOT (required_clause.tokens ?| ${tokens})
    )`
}

/** The live source proofs this request carries, as the connector-scoped clause both shapes apply. */
export function liveSourceAccessCondition(scope: KnowledgeAccessScope): SQL {
  return sql`(${githubInstallationAccessCondition(scope)} AND ${confluenceSiteAccessCondition(scope)})`
}

/**
 * The connectors a search may read from, resolved once per query: their ids grouped by the shape
 * their documents' ACLs take, and separately those whose reader access is proven live per request.
 */
/**
 * The caller's active member identities on the connectors a search reads, by what makes their
 * observations current: `confirmed` members drained their change feed inside the freshness window,
 * so every observation they hold stands; `observed` members are trusted only where the observation
 * itself is recent.
 */
/** One of the caller's member identities and the connector it belongs to. */
export interface KnowledgeMemberObserver {
  id: string
  connectorId: string
}

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

/**
 * The candidate predicate with connector state resolved ahead of the query instead of per row.
 *
 * Deletion, archival, a pending access rewrite, the organization's integration approval and the
 * access mode are facts about a connector, not a document, so checking them once per query leaves
 * each candidate an id comparison plus its own columns.
 *
 * `liveSourceAccess` is the caller's live source proof, and defaults to admitting everything:
 * candidate ranking defers that proof until after ranking, exactly as
 * {@link knowledgeMetadataCandidateAccessCondition} does, and only a reader that already holds the
 * grants — content hydration — passes it. The connectors it would gate are listed separately so
 * that clause is applied to those alone.
 *
 * Either way it narrows exactly as the predicate it stands in for: the eligible ids are the
 * connectors that predicate's `EXISTS` would admit, and every document-level clause is carried
 * over unchanged.
 */
export function knowledgeCandidateAccessConditionForConnectors(
  scope: KnowledgeAccessScope | SystemAccessScope,
  plan: SearchAccessPlan,
  liveSourceAccess: SQL = sql`true`
): SQL {
  const eligibility = plan.connectors
  if (scope.kind === 'system') return documentConnectorIsActive()
  if (scope.tokens.length === 0) return sql`false`
  const tokens = textArrayLiteral(scope.tokens)
  const cutoff = sql`statement_timestamp() - (${SOURCE_ACL_MAX_AGE_MS} * interval '1 millisecond')`
  const liveProof = new Set(eligibility.liveProofRequired)
  const inConnectors = (ids: readonly string[]): SQL =>
    ids.length === 0
      ? sql`false`
      : sql`${document.connectorId} = ANY(${textArrayLiteral([...ids])})`
  const mirrored = (ids: readonly string[], current: SQL): SQL => {
    const direct = ids.filter((id) => !liveProof.has(id))
    const gated = ids.filter((id) => liveProof.has(id))
    const currentAndMirrored = sql`${document.acl} <> ARRAY['ws']::text[] AND ${current}`
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
      (${workspaceOwned} AND ${document.acl} = ARRAY['ws']::text[])
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
  scope: KnowledgeAccessScope | SystemAccessScope,
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
  if (scope.kind === 'system') return sql`true`
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
 * A members-mode document is readable while one of the caller's active member identities on its
 * connector still observes it, freshly. Correlated on the document so each check is a lookup on
 * the observation primary key, which leads with `document_id`: phrased as a row-value `IN`
 * inside the access predicate's `OR`, PostgreSQL instead hashes every observation in the table
 * once per statement, a fixed cost paid by every query that carries the predicate.
 */
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

function memberObservationCondition(tokens: SQL, cutoff: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${knowledgeDocumentObservation}
    JOIN ${knowledgeConnectorMember}
      ON ${knowledgeConnectorMember.id} = ${knowledgeDocumentObservation.memberId}
    WHERE ${knowledgeDocumentObservation.documentId} = ${document.id}
      AND ${knowledgeConnectorMember.connectorId} = ${document.connectorId}
      AND ${knowledgeConnectorMember.status} = 'active'
      AND ${knowledgeConnectorMember.subjectToken} = ANY(${tokens})
      AND GREATEST(${knowledgeDocumentObservation.lastSeenAt}, ${knowledgeConnectorMember.memberSyncedThrough}) > ${cutoff}
  )`
}

function storedKnowledgeAccessCondition(
  scope: KnowledgeAccessScope | SystemAccessScope,
  liveSourceAccess: SQL
): SQL {
  if (scope.kind === 'system') return documentConnectorIsActive()
  if (scope.tokens.length === 0) return sql`false`
  const tokens = textArrayLiteral(scope.tokens)
  const cutoff = sql`statement_timestamp() - (${SOURCE_ACL_MAX_AGE_MS} * interval '1 millisecond')`
  return sql`(
    ${aclOverlap(tokens)}
    AND ${aclRequirementsSatisfied(tokens)}
    AND (
      (${document.connectorId} IS NULL AND ${document.acl} = ARRAY['ws']::text[])
      OR EXISTS (
        SELECT 1 FROM ${knowledgeConnector}
        WHERE ${knowledgeConnector.id} = ${document.connectorId}
          AND ${knowledgeConnector.deletedAt} IS NULL
          AND ${knowledgeConnector.archivedAt} IS NULL
          AND ${knowledgeConnector.accessRewritePending} = false
          AND ${searchIntegrationAccessCondition()}
          AND ${liveSourceAccess}
          AND (
            (${knowledgeConnector.accessMode} = 'workspace' AND ${document.acl} = ARRAY['ws']::text[])
            OR (${document.acl} <> ARRAY['ws']::text[] AND (
            (${knowledgeConnector.accessMode} = 'admin' AND ${document.aclVerifiedAt} > ${cutoff})
            OR (${knowledgeConnector.accessMode} = 'members' AND ${memberObservationCondition(tokens, cutoff)})
            ))
          )
      )
    )
  )`
}

/**
 * The token half of the stored access predicate: the documents a caller's tokens reach before
 * any source, freshness, or requirement check narrows them. It is a necessary condition of
 * {@link knowledgeAccessCondition}, never a substitute for it.
 *
 * Paired with `deleted_at IS NULL` it matches `doc_acl_gin_idx` exactly, so a query can enumerate
 * a member's reachable documents from that index alone. PostgreSQL cannot estimate array-overlap
 * selectivity, so left to itself it intersects this highly selective bitmap with base-wide ones.
 */
export function knowledgeAclOverlapCondition(scope: KnowledgeAccessScope): SQL {
  if (scope.tokens.length === 0) return sql`false`
  return aclOverlap(textArrayLiteral(scope.tokens))
}

/** One spelling of the token overlap, so the probe's reach and the full predicate cannot drift. */
function aclOverlap(tokens: SQL): SQL {
  return sql`${document.acl} && ${tokens}`
}

/**
 * The pool uses fetch_types: false, so arrays must be constructed from scalar
 * parameters. A JSON scalar keeps large sets below PostgreSQL's bind limit.
 */
export function textArrayLiteral(values: readonly string[]): SQL {
  if (values.length > 1000) {
    return sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(values)}::text::jsonb))`
  }
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )}]::text[]`
}
