import { v2ListKnowledgeTagsContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { listKnowledgeTags } from '@/lib/knowledge/application/tags'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/knowledge/[id]/tags — List the knowledge base's tag vocabulary.
 *
 * Full-set list: a knowledge base has a fixed number of tag slots, so the whole
 * vocabulary is one page and `nextCursor` is always null.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListKnowledgeTagsContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.listTags,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: listKnowledgeTags,
  present: ({ tagDefinitions }) => ({
    data: tagDefinitions.map((definition) => ({
      displayName: definition.displayName,
      tagSlot: definition.tagSlot,
      fieldType: definition.fieldType,
    })),
    nextCursor: null,
  }),
})
