import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { organizationSearchIntegration } from '@sim/db/schema'
import { sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOwnerContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { listOrganizationSearchApprovals } from '@/lib/knowledge/search/integration-policy'
import { SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'

interface SearchIntegrationInput {
  organizationId: string
}
interface ApproveSearchIntegrationInput extends SearchIntegrationInput {
  connectorType: string
  approved: boolean
}

export const listSearchIntegrations = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listSearchIntegrations,
  resolveContext: ({ input }: { input: SearchIntegrationInput }) =>
    resolveKnowledgeOwnerContext({ organizationId: input.organizationId }),
  async execute({ context }) {
    if (!context.organizationId)
      throw new OrchestrationError('validation', 'Organization is required')
    const approvals = await listOrganizationSearchApprovals(context.organizationId)
    return SEARCH_SOURCE_TYPES.map(([connectorType]) => ({
      connectorType,
      approved: approvals.get(connectorType) ?? false,
    }))
  },
})

/** Approval alone never creates a credential, connects the admin, or starts indexing. */
export const approveSearchIntegration = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.approveSearchIntegration,
  resolveContext: ({ input }: { input: ApproveSearchIntegrationInput }) =>
    resolveKnowledgeOwnerContext({ organizationId: input.organizationId }),
  async execute({ input, context }) {
    if (!context.organizationId)
      throw new OrchestrationError('validation', 'Organization is required')
    if (!SEARCH_SOURCE_TYPES.some(([type]) => type === input.connectorType)) {
      throw new OrchestrationError('validation', 'This integration is not supported by Sim Search')
    }
    const changed = await db
      .insert(organizationSearchIntegration)
      .values({
        organizationId: context.organizationId,
        connectorType: input.connectorType,
        approved: input.approved,
      })
      .onConflictDoUpdate({
        target: [
          organizationSearchIntegration.organizationId,
          organizationSearchIntegration.connectorType,
        ],
        set: { approved: input.approved, updatedAt: new Date() },
        setWhere: sql`${organizationSearchIntegration.approved} IS DISTINCT FROM ${input.approved}`,
      })
      .returning({ connectorType: organizationSearchIntegration.connectorType })
    return {
      connectorType: input.connectorType,
      approved: input.approved,
      changed: changed.length > 0,
    }
  },
  projectAudit: ({ context, result }) =>
    result.changed
      ? {
          action: AuditAction.ORGANIZATION_UPDATED,
          resourceType: AuditResourceType.ORGANIZATION,
          resourceId: context.organizationId,
          description: `${result.approved ? 'Approved' : 'Deactivated'} ${result.connectorType} for Sim Search`,
          metadata: { connectorType: result.connectorType, approved: result.approved },
        }
      : [],
})
