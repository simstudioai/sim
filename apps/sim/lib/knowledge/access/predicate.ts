import {
  document,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
} from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'
import { SOURCE_ACL_MAX_AGE_MS } from '@/lib/knowledge/access/freshness'
import type { KnowledgeAccessScope, SystemAccessScope } from '@/lib/knowledge/access/types'
import { searchIntegrationAccessCondition } from '@/lib/knowledge/search/integration-policy'

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
