import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
  member,
  user,
} from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'
import { SOURCE_ACL_MAX_AGE_MS } from '@/lib/knowledge/access/freshness'
import type { KnowledgeAccessScope, SystemAccessScope } from '@/lib/knowledge/access/types'
import { searchIntegrationAccessCondition } from '@/lib/knowledge/search/integration-policy'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'

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
 * caller's token set. Tokens are bound as scalars and assembled with
 * `ARRAY[...]` because the shared pool runs with `fetch_types: false`, under
 * which a JS array bound as one parameter fails at execution (see
 * packages/db/db.ts). A literal array also keeps the planner's statistics on
 * `acl` usable, which is what lets it choose the GIN index for a selective set.
 *
 * Additional clauses preserve source intersections. Source-derived grants also
 * require recent evidence, independent of scheduler health. A drained member
 * change feed confirms unchanged observations through `memberSyncedThrough`;
 * partial listings confirm only the documents actually observed.
 */
export function knowledgeAccessCondition(scope: KnowledgeAccessScope | SystemAccessScope): SQL {
  return storedKnowledgeAccessCondition(
    scope,
    scope.kind === 'system' ? sql`true` : githubInstallationAccessCondition(scope)
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

function storedKnowledgeAccessCondition(
  scope: KnowledgeAccessScope | SystemAccessScope,
  liveSourceAccess: SQL
): SQL {
  if (scope.kind === 'system') return sql`true`
  if (scope.tokens.length === 0) return sql`false`
  const tokens = textArrayLiteral(scope.tokens)
  const cutoff = sql`statement_timestamp() - (${SOURCE_ACL_MAX_AGE_MS} * interval '1 millisecond')`
  return sql`(
    ${document.acl} && ${tokens}
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(${document.aclRequirements}) AS required_clause(tokens)
      WHERE NOT (required_clause.tokens ?| ${tokens})
    )
    AND (
      (${document.connectorId} IS NULL AND ${document.acl} = ARRAY['ws']::text[])
      OR EXISTS (
        SELECT 1 FROM ${knowledgeConnector}
        WHERE ${knowledgeConnector.id} = ${document.connectorId}
          AND ${searchIntegrationAccessCondition()}
          AND ${liveSourceAccess}
          AND (
            (${knowledgeConnector.accessMode} = 'workspace' AND ${document.acl} = ARRAY['ws']::text[])
            OR (${document.acl} <> ARRAY['ws']::text[] AND (
            (${knowledgeConnector.accessMode} = 'admin' AND ${document.aclVerifiedAt} > ${cutoff})
            OR (${knowledgeConnector.accessMode} = 'members' AND EXISTS (
              SELECT 1 FROM ${knowledgeDocumentObservation}
              JOIN ${knowledgeConnectorMember}
                ON ${knowledgeConnectorMember.id} = ${knowledgeDocumentObservation.memberId}
              WHERE ${knowledgeDocumentObservation.documentId} = ${document.id}
                AND ${knowledgeConnectorMember.connectorId} = ${document.connectorId}
                AND ${knowledgeConnectorMember.status} = 'active'
                AND ${knowledgeConnectorMember.subjectToken} = ANY(${tokens})
                AND GREATEST(${knowledgeDocumentObservation.lastSeenAt}, ${knowledgeConnectorMember.memberSyncedThrough}) > ${cutoff}
            ))
            ))
          )
      )
    )
  )`
}

/**
 * A `text[]` literal assembled from scalar binds, for comparing against an
 * ACL column. Every place that compares ACLs builds its array this way, for
 * the `fetch_types: false` reason above.
 */
export function textArrayLiteral(values: readonly string[]): SQL {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )}]::text[]`
}
