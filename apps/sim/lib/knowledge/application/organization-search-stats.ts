import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOwnerContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  loadOrganizationSearchStats,
  type SearchStatsInput,
} from '@/lib/knowledge/search/activity-stats'
import { assertIndexedOrgSearchEnabled } from '@/lib/sim-search/indexed/gate'

/** The indexed Stats tab's activity report; refused while indexed organization search is dormant. */
export const readOrganizationSearchStats = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readOrganizationSearchStats,
  resolveContext: ({ input }: { input: SearchStatsInput }) =>
    resolveKnowledgeOwnerContext({ organizationId: input.organizationId }),
  async execute({ context, input }) {
    assertIndexedOrgSearchEnabled()
    if (!context.organizationId)
      throw new OrchestrationError('validation', 'Organization is required')
    await requireOrganizationSearchAvailable(context.organizationId)
    return loadOrganizationSearchStats({ ...input, organizationId: context.organizationId })
  },
})
