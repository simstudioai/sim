import { v2ListKnowledgeTagsContract } from '@/lib/api/contracts/v2/knowledge'
import { v2CreateKnowledgeTagContract } from '@/lib/api/contracts/v2/knowledge-tags'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { createKnowledgeTag, listKnowledgeTags } from '@/lib/knowledge/application/tags'
import { toV2KnowledgeTag } from '@/app/api/v2/knowledge/utils'

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
    data: tagDefinitions.map(toV2KnowledgeTag),
    nextCursor: null,
  }),
})

/**
 * POST /api/v2/knowledge/[id]/tags — Define a tag on the knowledge base.
 *
 * Omitting `tagSlot` takes the next free slot for the field type; exhausting
 * the type's slots is a 400 naming it, because the remedy is a different field
 * type or a deleted definition rather than a retry.
 */
export const POST = defineV2JsonRoute({
  contract: v2CreateKnowledgeTagContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.createTag,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.id,
    assertedWorkspaceId: body.workspaceId,
    displayName: body.displayName,
    fieldType: body.fieldType,
    tagSlot: body.tagSlot,
    source: 'api' as const,
  }),
  useCase: createKnowledgeTag,
  present: ({ tagDefinition }) => ({ data: toV2KnowledgeTag(tagDefinition) }),
})
