import {
  createKnowledgeBaseContract,
  listKnowledgeBasesContract,
} from '@/lib/api/contracts/knowledge'
import { validationErrorResponse } from '@/lib/api/server'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  internalKnowledgeAnalytics,
  internalKnowledgePresenters,
} from '@/lib/knowledge/api/internal-route'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import {
  createKnowledgeBase,
  listInternalKnowledgeBases,
} from '@/lib/knowledge/application/knowledge-bases'
import {
  knowledgeOperations,
  knowledgeSessionOperations,
} from '@/lib/knowledge/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listKnowledgeBasesContract,
  auth: internalSessionAuth,
  operation: knowledgeSessionOperations.list,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal knowledge base listing behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.list,
  parseOptions: {
    validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid query parameters'),
  },
  mapInput: ({ query }) => ({ workspaceId: query.workspaceId, scope: query.scope }),
  useCase: listInternalKnowledgeBases,
  present: internalKnowledgePresenters.list,
})

export const POST = defineInternalJsonRoute({
  contract: createKnowledgeBaseContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.create,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal knowledge base creation behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.create,
  parseOptions: {
    validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request data'),
  },
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    name: body.name,
    description: body.description,
    folderId: body.folderId,
    chunkingConfig: body.chunkingConfig,
    source: 'ui',
  }),
  useCase: createKnowledgeBase,
  onSuccess: internalKnowledgeAnalytics.created,
  present: internalKnowledgePresenters.create,
})
