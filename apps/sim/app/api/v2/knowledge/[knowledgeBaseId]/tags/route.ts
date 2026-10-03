import { v2ListKnowledgeTagsContract } from '@/lib/api/contracts/v2/knowledge'
import {
  v2BulkSaveKnowledgeTagDefinitionsContract,
  v2CreateKnowledgeTagContract,
  v2DeleteKnowledgeTagDefinitionsContract,
} from '@/lib/api/contracts/v2/knowledge-tags'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  createKnowledgeTag,
  deleteKnowledgeDocumentTagDefinitions,
  listKnowledgeTags,
  saveKnowledgeDocumentTagDefinitions,
} from '@/lib/knowledge/application/tags'
import { toV2KnowledgeTag } from '@/app/api/v2/knowledge/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/knowledge/[knowledgeBaseId]/tags — List the knowledge base's tag vocabulary.
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
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: listKnowledgeTags,
  present: ({ tagDefinitions }) => ({
    data: tagDefinitions.map(toV2KnowledgeTag),
    nextCursor: null,
  }),
})

/**
 * POST /api/v2/knowledge/[knowledgeBaseId]/tags — Define a tag on the knowledge base.
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
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: body.workspaceId,
    displayName: body.displayName,
    fieldType: body.fieldType,
    tagSlot: body.tagSlot,
    source: 'api' as const,
  }),
  useCase: createKnowledgeTag,
  present: ({ tagDefinition }) => ({ data: toV2KnowledgeTag(tagDefinition) }),
})

/**
 * PUT /api/v2/knowledge/[knowledgeBaseId]/tags — Upsert the tag vocabulary in bulk.
 *
 * The knowledge-base counterpart of `POST`, which defines exactly one tag. Every
 * slot the body names is written to the declaration it carries; slots it does
 * not name are untouched.
 *
 * This write used to sit at `PUT /knowledge/{knowledgeBaseId}/documents/{documentId}/tags`,
 * where the document id was read only to find the knowledge base behind it. Tag
 * *values* on one document are still written by
 * `PATCH /api/v2/knowledge/{knowledgeBaseId}/documents/{documentId}` through its tag slots.
 */
export const PUT = defineV2JsonRoute({
  contract: v2BulkSaveKnowledgeTagDefinitionsContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.saveDocumentTagDefinitions,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: body.workspaceId,
    definitions: body.definitions,
  }),
  useCase: saveKnowledgeDocumentTagDefinitions,
  present: ({ created, updated, errors }) => ({
    data: {
      created: created.map(toV2KnowledgeTag),
      updated: updated.map(toV2KnowledgeTag),
      errors,
    },
  }),
})

/**
 * DELETE /api/v2/knowledge/[knowledgeBaseId]/tags — Remove tag definitions from the base.
 *
 * `unused` defaults to `true`, removing only definitions no document still
 * carries a value for. `unused=false` deletes the whole vocabulary and clears
 * every slot it defined, so it has to be asked for.
 */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteKnowledgeTagDefinitionsContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.deleteDocumentTagDefinitions,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: query.workspaceId,
    action: query.unused ? ('cleanup' as const) : ('all' as const),
  }),
  useCase: deleteKnowledgeDocumentTagDefinitions,
  /**
   * `unused` is read back from the parsed request rather than re-derived from
   * the domain's `action`, so the two spellings cannot drift: the route decides
   * the branch and reports the same decision it made.
   */
  present: ({ count }, { query }) => ({ data: { unused: query.unused, count } }),
})
