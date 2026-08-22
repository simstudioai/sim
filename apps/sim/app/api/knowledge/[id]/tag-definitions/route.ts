import {
  createTagDefinitionContract,
  listTagDefinitionsContract,
} from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { toInternalKnowledgeTag } from '@/lib/knowledge/api/internal-route'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { createKnowledgeTag, listKnowledgeTags } from '@/lib/knowledge/application/tags'

export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: listTagDefinitionsContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.listTags,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal tag-list behavior' }),
  errorPolicy: internalKnowledgeErrorPolicies.tags,
  mapInput: ({ params }) => ({ knowledgeBaseId: params.id }),
  useCase: listKnowledgeTags,
  present: ({ tagDefinitions }) => ({
    success: true as const,
    data: tagDefinitions.map(toInternalKnowledgeTag),
  }),
})

export const POST = defineInternalJsonRoute({
  contract: createTagDefinitionContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.createTag,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal tag-create behavior' }),
  errorPolicy: internalKnowledgeErrorPolicies.tags,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.id,
    tagSlot: body.tagSlot,
    displayName: body.displayName,
    fieldType: body.fieldType,
    source: 'ui' as const,
  }),
  useCase: createKnowledgeTag,
  present: ({ tagDefinition }) => ({
    success: true as const,
    data: toInternalKnowledgeTag(tagDefinition),
  }),
})
