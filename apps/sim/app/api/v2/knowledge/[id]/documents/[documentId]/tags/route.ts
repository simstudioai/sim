import {
  v2DeleteKnowledgeDocumentTagDefinitionsContract,
  v2SaveKnowledgeDocumentTagDefinitionsContract,
} from '@/lib/api/contracts/v2/knowledge-tags'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  deleteKnowledgeDocumentTagDefinitions,
  saveKnowledgeDocumentTagDefinitions,
} from '@/lib/knowledge/application/tags'
import { toV2KnowledgeTag } from '@/app/api/v2/knowledge/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * PUT /api/v2/knowledge/[id]/documents/[documentId]/tags — Declare the tag
 * definitions a document's tags need.
 *
 * Scoped to a document because that is where a caller discovers it needs a
 * definition, but the definitions themselves belong to the knowledge base and
 * apply to every document in it.
 */
export const PUT = defineV2JsonRoute({
  contract: v2SaveKnowledgeDocumentTagDefinitionsContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.saveDocumentTagDefinitions,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
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
 * DELETE /api/v2/knowledge/[id]/documents/[documentId]/tags — Remove tag
 * definitions no document still uses.
 *
 * Cleanup only. The domain operation also accepts `action: 'all'`, which
 * deletes every definition on the knowledge base rather than the document's;
 * the contract pins `action` to `'cleanup'` so a whole-vocabulary wipe is not
 * reachable from a document-scoped path.
 */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteKnowledgeDocumentTagDefinitionsContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.deleteDocumentTagDefinitions,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
    assertedWorkspaceId: query.workspaceId,
    action: query.action,
  }),
  useCase: deleteKnowledgeDocumentTagDefinitions,
  present: ({ action, count }) => {
    if (action !== 'cleanup') {
      throw new Error('Whole-knowledge-base tag deletion is not exposed on the public API')
    }
    return { data: { action, count } }
  },
})
