import {
  deleteKnowledgeBaseContract,
  getKnowledgeBaseContract,
  updateKnowledgeBaseContract,
} from '@/lib/api/contracts/knowledge'
import { validationErrorResponse } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgePresenters } from '@/lib/knowledge/api/internal-route'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import {
  deleteInternalKnowledgeBase,
  readInternalKnowledgeBase,
  updateInternalKnowledgeBase,
} from '@/lib/knowledge/application/knowledge-bases'
import { knowledgeSessionOperations } from '@/lib/knowledge/application/operations'

export const GET = defineInternalJsonRoute({
  contract: getKnowledgeBaseContract,
  auth: internalSessionAuth,
  operation: knowledgeSessionOperations.read,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal knowledge base detail behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.read,
  mapInput: ({ params }) => ({ knowledgeBaseId: params.id }),
  useCase: readInternalKnowledgeBase,
  present: internalKnowledgePresenters.read,
})

export const PUT = defineInternalJsonRoute({
  contract: updateKnowledgeBaseContract,
  auth: internalSessionAuth,
  operation: knowledgeSessionOperations.update,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal knowledge base update behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.update,
  parseOptions: {
    validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request data'),
  },
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.id,
    name: body.name,
    description: body.description,
    workspaceId: body.workspaceId,
    folderId: body.folderId,
    chunkingConfig: body.chunkingConfig,
  }),
  useCase: updateInternalKnowledgeBase,
  present: internalKnowledgePresenters.read,
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteKnowledgeBaseContract,
  auth: internalSessionAuth,
  operation: knowledgeSessionOperations.delete,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal knowledge base deletion behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.delete,
  mapInput: ({ params }) => ({ knowledgeBaseId: params.id }),
  useCase: deleteInternalKnowledgeBase,
  present: internalKnowledgePresenters.deleted,
})
