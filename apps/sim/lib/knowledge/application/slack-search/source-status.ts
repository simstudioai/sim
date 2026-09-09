import { db } from '@sim/db'
import { document, embedding, knowledgeBase } from '@sim/db/schema'
import { and, eq, exists, isNull } from 'drizzle-orm'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import { createKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'

const operation = defineOrganizationOperation({
  id: 'knowledge.slack.sources.status',
  capability: 'knowledge.use',
  minimumRole: 'member',
  principalKinds: ['session', 'organization_delegated'],
  delegatedServices: ['slack-search'],
  delegationAudience: 'sim:knowledge',
})

/** Checks accessible indexed content, never treating another member's connection as the sender's. */
export const getSlackSearchSourceStatus: OperationUseCase<
  typeof operation,
  { organizationId: string },
  { hasSearchableDocuments: boolean }
> = {
  operation,
  async execute({ principal, input }) {
    await authorizeOrganizationOperation(principal, operation, input)
    const access = await createKnowledgeAccessProvider(principal, input).get()
    const [visible] = await db
      .select({ id: document.id })
      .from(document)
      .innerJoin(knowledgeBase, eq(knowledgeBase.id, document.knowledgeBaseId))
      .where(
        and(
          eq(knowledgeBase.organizationId, input.organizationId),
          eq(knowledgeBase.isSearchIndex, true),
          isNull(knowledgeBase.deletedAt),
          eq(document.processingStatus, 'completed'),
          eq(document.enabled, true),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt),
          knowledgeAccessCondition(access),
          exists(
            db
              .select({ id: embedding.id })
              .from(embedding)
              .where(and(eq(embedding.documentId, document.id), eq(embedding.enabled, true)))
          )
        )
      )
      .limit(1)
    return { hasSearchableDocuments: Boolean(visible) }
  },
}
