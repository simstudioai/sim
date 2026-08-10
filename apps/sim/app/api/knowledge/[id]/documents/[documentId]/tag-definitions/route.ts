import {
  deleteDocumentTagDefinitionsContract,
  listDocumentTagDefinitionsContract,
  saveDocumentTagDefinitionsContract,
} from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { toInternalKnowledgeTag } from '@/lib/knowledge/api/internal-route'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  deleteKnowledgeDocumentTagDefinitions,
  listKnowledgeDocumentTagDefinitions,
  saveKnowledgeDocumentTagDefinitions,
} from '@/lib/knowledge/application/tags'

const rateLimit = internalRateLimits.none({
  reason: 'Preserve existing internal document-tag behavior',
})

export const GET = defineInternalJsonRoute({
  contract: listDocumentTagDefinitionsContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.listTags,
  rateLimit,
  errorPolicy: internalKnowledgeErrorPolicies.tags,
  mapInput: ({ params }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
  }),
  useCase: listKnowledgeDocumentTagDefinitions,
  present: ({ tagDefinitions }) => ({
    success: true as const,
    data: tagDefinitions.map(toInternalKnowledgeTag),
  }),
})

export const POST = defineInternalJsonRoute({
  contract: saveDocumentTagDefinitionsContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.saveDocumentTagDefinitions,
  rateLimit,
  errorPolicy: internalKnowledgeErrorPolicies.tags,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
    definitions: body.definitions.map((definition) => ({
      tagSlot: definition.tagSlot,
      displayName: definition.displayName,
      fieldType: definition.fieldType,
      originalDisplayName: definition._originalDisplayName,
    })),
  }),
  useCase: saveKnowledgeDocumentTagDefinitions,
  present: ({ created, updated, errors }) => ({
    success: true as const,
    data: {
      created: created.map(toInternalKnowledgeTag),
      updated: updated.map(toInternalKnowledgeTag),
      errors,
    },
  }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteDocumentTagDefinitionsContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.deleteDocumentTagDefinitions,
  rateLimit,
  errorPolicy: internalKnowledgeErrorPolicies.tags,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
    action: query.action,
  }),
  useCase: deleteKnowledgeDocumentTagDefinitions,
  present: ({ action, count }) =>
    action === 'cleanup'
      ? { success: true as const, data: { cleanedUp: count } }
      : {
          success: true as const,
          message: 'Tag definitions deleted successfully',
          data: { deleted: count },
        },
})
