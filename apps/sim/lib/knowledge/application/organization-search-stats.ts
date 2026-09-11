import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOwnerContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  loadOrganizationSearchStats,
  type SearchStatsInput,
} from '@/lib/knowledge/search/activity-stats'

export const readOrganizationSearchStats = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readOrganizationSearchStats,
  resolveContext: ({ input }: { input: SearchStatsInput }) =>
    resolveKnowledgeOwnerContext({ organizationId: input.organizationId }),
  async execute({ context, input }) {
    if (!context.organizationId)
      throw new OrchestrationError('validation', 'Organization is required')
    await requireOrganizationSearchAvailable(context.organizationId)
    return loadOrganizationSearchStats({ ...input, organizationId: context.organizationId })
  },
})
