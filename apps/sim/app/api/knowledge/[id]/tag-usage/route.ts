import { getTagUsageContract } from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readDetailedKnowledgeTagUsage } from '@/lib/knowledge/application/tags'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getTagUsageContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.readDetailedTagUsage,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal tag-usage behavior' }),
  errorPolicy: internalKnowledgeErrorPolicies.tags,
  mapInput: ({ params }) => ({ knowledgeBaseId: params.id }),
  useCase: readDetailedKnowledgeTagUsage,
  present: ({ usage }) => ({ success: true as const, data: usage }),
})
