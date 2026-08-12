import {
  v2DeleteKnowledgeBaseContract,
  v2GetKnowledgeBaseContract,
  v2UpdateKnowledgeBaseContract,
} from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { PlatformEvents } from '@/lib/core/telemetry'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import {
  deleteKnowledgeBaseOperation,
  readKnowledgeBase,
  updateKnowledgeBaseOperation,
} from '@/lib/knowledge/application/knowledge-bases'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { toV2KnowledgeBase } from '@/app/api/v2/knowledge/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/knowledge/[id] — Get knowledge base details. */
export const GET = defineV2JsonRoute({
  contract: v2GetKnowledgeBaseContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: readKnowledgeBase,
  present: async ({ knowledgeBase, folderPath }) => ({
    data: await toV2KnowledgeBase(knowledgeBase, folderPath),
  }),
})

/** PATCH /api/v2/knowledge/[id] — Partially update a knowledge base. */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateKnowledgeBaseContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.update,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.id,
    assertedWorkspaceId: body.workspaceId,
    name: body.name,
    description: body.description,
    chunkingConfig: body.chunkingConfig,
    folderPath: body.folderPath,
    source: 'api',
  }),
  useCase: updateKnowledgeBaseOperation,
  present: async ({ knowledgeBase, folderPath }) => ({
    data: await toV2KnowledgeBase(knowledgeBase, folderPath),
  }),
})

/** DELETE /api/v2/knowledge/[id] — Delete a knowledge base. */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteKnowledgeBaseContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.delete,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    assertedWorkspaceId: query.workspaceId,
    source: 'api',
  }),
  useCase: deleteKnowledgeBaseOperation,
  onSuccess: ({ result }) => {
    PlatformEvents.knowledgeBaseDeleted({ knowledgeBaseId: result.id })
  },
  present: ({ id }) => ({ data: { id, deleted: true as const } }),
})
