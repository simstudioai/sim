import { bulkDeleteKnowledgeItemsContract } from '@/lib/api/contracts/knowledge'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { bulkDeleteKnowledgeItems } from '@/lib/knowledge/application/bulk'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const POST = defineInternalJsonRoute({
  contract: bulkDeleteKnowledgeItemsContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.bulkDeleteItems,
  rateLimit: internalRateLimits.none({
    reason: 'Matches the unlimited single-base and single-folder deletes it batches',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.bulkDelete,
  mapInput: ({ body }) => ({
    assertedWorkspaceId: body.workspaceId,
    knowledgeBaseIds: body.knowledgeBaseIds,
    folderIds: body.folderIds,
    source: 'ui',
  }),
  useCase: bulkDeleteKnowledgeItems,
  present: ({ deleted, skipped, notFound, failed, deletedItems }) => ({
    success: true as const,
    data: { deleted, skipped, notFound, failed, deletedItems },
  }),
})
