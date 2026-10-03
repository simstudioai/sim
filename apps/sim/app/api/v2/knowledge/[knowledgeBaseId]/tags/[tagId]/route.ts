import {
  v2DeleteKnowledgeTagContract,
  v2UpdateKnowledgeTagContract,
} from '@/lib/api/contracts/v2/knowledge-tags'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { deleteKnowledgeTag, updateKnowledgeTag } from '@/lib/knowledge/application/tags'
import { toV2KnowledgeTag } from '@/app/api/v2/knowledge/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * PATCH /api/v2/knowledge/[knowledgeBaseId]/tags/[tagId] — Rename a tag or change its type.
 *
 * `knowledgeBaseId` is passed so the definition is resolved through the base the
 * path names; without it a definition belonging to a sibling knowledge base
 * would answer from this path.
 */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateKnowledgeTagContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.updateTag,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, body }) => ({
    tagDefinitionId: params.tagId,
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: body.workspaceId,
    updates: { displayName: body.displayName, fieldType: body.fieldType },
    source: 'api' as const,
  }),
  useCase: updateKnowledgeTag,
  present: ({ tagDefinition }) => ({ data: toV2KnowledgeTag(tagDefinition) }),
})

/**
 * DELETE /api/v2/knowledge/[knowledgeBaseId]/tags/[tagId] — Remove a tag definition.
 *
 * The slot's values are cleared across every document and chunk in the
 * knowledge base: without a definition the slot has no meaning, so leaving the
 * values would strand them under a raw slot name.
 */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteKnowledgeTagContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.deleteTag,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    tagDefinitionId: params.tagId,
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: query.workspaceId,
    source: 'api' as const,
  }),
  useCase: deleteKnowledgeTag,
  present: (deleted) => ({
    data: {
      id: deleted.tagDefinitionId,
      tagSlot: deleted.tagSlot,
      displayName: deleted.displayName,
      deleted: true as const,
    },
  }),
})
