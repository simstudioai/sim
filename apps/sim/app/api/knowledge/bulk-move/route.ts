import { bulkMoveKnowledgeItemsContract } from '@/lib/api/contracts/knowledge'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { bulkMoveKnowledgeItems } from '@/lib/knowledge/application/bulk'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const POST = defineInternalJsonRoute({
  contract: bulkMoveKnowledgeItemsContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.bulkMoveItems,
  rateLimit: internalRateLimits.none({
    reason: 'Matches the unlimited single-base and single-folder moves it batches',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.bulkMove,
  mapInput: ({ body }) => ({
    assertedWorkspaceId: body.workspaceId,
    knowledgeBaseIds: body.knowledgeBaseIds,
    folderIds: body.folderIds,
    targetFolderId: body.targetFolderId,
    source: 'ui',
  }),
  useCase: bulkMoveKnowledgeItems,
  present: ({ moved, skipped, notFound, failed }) => ({
    success: true as const,
    data: { moved, skipped, notFound, failed },
  }),
})
