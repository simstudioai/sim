import { v2ListKnowledgeTagUsageContract } from '@/lib/api/contracts/v2/knowledge-tags'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readKnowledgeTagUsage } from '@/lib/knowledge/application/tags'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/knowledge/[knowledgeBaseId]/tags/usage — How widely each tag is populated.
 *
 * Full-set list, for the same reason the vocabulary is: one row per definition,
 * and the fixed slot table bounds how many definitions can exist.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListKnowledgeTagUsageContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.readTagUsage,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: readKnowledgeTagUsage,
  present: ({ usage }) => ({ data: usage, nextCursor: null }),
})
