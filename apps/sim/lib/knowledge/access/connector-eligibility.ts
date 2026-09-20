import { db } from '@sim/db'
import { knowledgeConnector } from '@sim/db/schema'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { KnowledgeConnectorEligibility } from '@/lib/knowledge/access/predicate'
import { searchIntegrationAccessCondition } from '@/lib/knowledge/search/integration-policy'

/**
 * The connectors a search may read from, grouped by access mode, with the ones whose reader access
 * must be proven live marked.
 *
 * Deletion, archival, a pending access rewrite and the organization's integration approval are
 * facts about a connector. Resolving them once per query — there are tens of connectors against
 * hundreds of thousands of documents — leaves each candidate its own columns to check.
 */
export async function resolveConnectorEligibility(
  knowledgeBaseIds: readonly string[]
): Promise<KnowledgeConnectorEligibility> {
  const eligibility: {
    workspace: string[]
    admin: string[]
    members: string[]
    liveProofRequired: string[]
  } = { workspace: [], admin: [], members: [], liveProofRequired: [] }
  if (knowledgeBaseIds.length === 0) return eligibility
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
    const live =
      (row.connectorType === 'github' && row.githubRepository) ||
      (row.connectorType === 'confluence' && row.accessMode === 'admin')
    if (live) eligibility.liveProofRequired.push(row.id)
  }
  return eligibility
}
