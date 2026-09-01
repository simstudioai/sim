import { deleteTagDefinitionContract } from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { deleteKnowledgeTag } from '@/lib/knowledge/application/tags'

export const dynamic = 'force-dynamic'

export const DELETE = defineInternalJsonRoute({
  contract: deleteTagDefinitionContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.deleteTag,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal tag-delete behavior' }),
  errorPolicy: internalKnowledgeErrorPolicies.tags,
  mapInput: ({ params }) => ({
    knowledgeBaseId: params.id,
    tagDefinitionId: params.tagId,
    source: 'ui' as const,
  }),
  useCase: deleteKnowledgeTag,
  present: (deleted) => ({
    success: true as const,
    message: `Tag definition "${deleted.displayName}" deleted successfully`,
  }),
})
