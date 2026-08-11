import {
  v2CreateKnowledgeBaseContract,
  v2ListKnowledgeBasesContract,
} from '@/lib/api/contracts/v2/knowledge'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { PlatformEvents } from '@/lib/core/telemetry'
import {
  createKnowledgeBase,
  listKnowledgeBases,
} from '@/lib/knowledge/application/knowledge-bases'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { captureServerEvent } from '@/lib/posthog/server'
import { toV2KnowledgeBase, toV2KnowledgeBases } from '@/app/api/v2/knowledge/utils'
import { v2Error } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/knowledge — List knowledge bases in a workspace. */
export const GET = defineV2JsonRoute({
  contract: v2ListKnowledgeBasesContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.list,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    folderPath: query.folderPath,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  }),
  useCase: listKnowledgeBases,
  present: async ({ knowledgeBases }) => ({
    data: await toV2KnowledgeBases(knowledgeBases),
    nextCursor: null,
  }),
})

/** POST /api/v2/knowledge — Create a new knowledge base. */
export const POST = defineV2JsonRoute({
  contract: v2CreateKnowledgeBaseContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.create,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  parseOptions: {
    invalidJsonResponse: () => v2Error('BAD_REQUEST', 'Request body must be valid JSON'),
  },
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    name: body.name,
    description: body.description,
    chunkingConfig: body.chunkingConfig,
    folderPath: body.folderPath,
    source: 'api',
  }),
  useCase: createKnowledgeBase,
  onSuccess: ({ principal, result: { knowledgeBase } }) => {
    PlatformEvents.knowledgeBaseCreated({
      knowledgeBaseId: knowledgeBase.id,
      name: knowledgeBase.name,
      workspaceId: knowledgeBase.workspaceId ?? undefined,
    })
    if (principal.kind === 'personal_api_key') {
      captureServerEvent(
        principal.userId,
        'knowledge_base_created',
        {
          knowledge_base_id: knowledgeBase.id,
          workspace_id: knowledgeBase.workspaceId ?? '',
          name: knowledgeBase.name,
        },
        {
          ...(knowledgeBase.workspaceId
            ? { groups: { workspace: knowledgeBase.workspaceId } }
            : {}),
          setOnce: { first_kb_created_at: new Date().toISOString() },
        }
      )
    }
  },
  present: async ({ knowledgeBase, folderPath }) => ({
    data: await toV2KnowledgeBase(knowledgeBase, folderPath),
  }),
})
