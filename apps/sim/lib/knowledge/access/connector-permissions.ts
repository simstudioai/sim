import { db } from '@sim/db'
import {
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorPermissionGrant,
} from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { connectorPermissionGroupToken } from '@/lib/knowledge/connectors/permission-tokens'

/** The caller has already verified this email and current membership in the canonical owner. */
export async function loadConnectorPermissionGroupTokens(
  subjectToken: string,
  scope: ResourceScope
): Promise<string[]> {
  const grant = knowledgeConnectorPermissionGrant
  const rows = await db
    .select({ connectorId: grant.connectorId, groupKey: grant.groupKey })
    .from(grant)
    .innerJoin(knowledgeConnector, eq(knowledgeConnector.id, grant.connectorId))
    .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
    .where(
      and(
        eq(grant.subjectToken, subjectToken),
        eq(knowledgeConnector.accessMode, 'admin'),
        eq(knowledgeConnector.accessRewritePending, false),
        resourceScopeCondition(knowledgeBase, scope),
        isNull(knowledgeBase.deletedAt),
        isNull(knowledgeConnector.deletedAt),
        isNull(knowledgeConnector.archivedAt)
      )
    )
  return rows.map((row) => connectorPermissionGroupToken(row.connectorId, row.groupKey))
}
