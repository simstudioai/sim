import { db } from '@sim/db'
import { knowledgeBase, knowledgeConnector, organizationSearchIntegration } from '@sim/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Existing configured sources retain approval until an admin records an explicit decision. */
export async function listOrganizationSearchApprovals(organizationId: string) {
  const [decisions, configured] = await Promise.all([
    db
      .select({
        connectorType: organizationSearchIntegration.connectorType,
        approved: organizationSearchIntegration.approved,
      })
      .from(organizationSearchIntegration)
      .where(eq(organizationSearchIntegration.organizationId, organizationId)),
    db
      .selectDistinct({ connectorType: knowledgeConnector.connectorType })
      .from(knowledgeConnector)
      .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
      .where(
        and(
          eq(knowledgeBase.organizationId, organizationId),
          eq(knowledgeBase.isSearchIndex, true),
          isNull(knowledgeBase.deletedAt),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      ),
  ])
  const approvals = new Map(configured.map(({ connectorType }) => [connectorType, true]))
  for (const decision of decisions) approvals.set(decision.connectorType, decision.approved)
  return approvals
}

export async function requireOrganizationSearchApproval(
  organizationId: string,
  connectorType: string
) {
  if ((await listOrganizationSearchApprovals(organizationId)).get(connectorType) !== true) {
    throw new OrchestrationError(
      'forbidden',
      'Ask an organization admin to approve this integration for Sim Search'
    )
  }
}

/** Applies organization approval to every connector-backed document, including public ACLs. */
export function searchIntegrationAccessCondition() {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${knowledgeBase}
    JOIN ${organizationSearchIntegration}
      ON ${organizationSearchIntegration.organizationId} = ${knowledgeBase.organizationId}
      AND ${organizationSearchIntegration.connectorType} = ${knowledgeConnector.connectorType}
    WHERE ${knowledgeBase.id} = ${knowledgeConnector.knowledgeBaseId}
      AND ${knowledgeBase.isSearchIndex} = true
      AND ${organizationSearchIntegration.approved} = false
  )`
}
