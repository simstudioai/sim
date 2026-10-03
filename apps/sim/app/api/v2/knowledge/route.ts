import { isUserCredentialPrincipal } from '@sim/auth/principal'
import {
  v2CreateKnowledgeBaseContract,
  v2ListKnowledgeBasesContract,
} from '@/lib/api/contracts/v2/knowledge'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
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
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which knowledge bases, in which order, this list returns. */
function knowledgeCursorFilters(query: {
  workspaceId: string
  scope?: string
  folderPath?: string
  search?: string
}) {
  return cursorScopeKey(cursorRoute(v2ListKnowledgeBasesContract), {
    workspaceId: query.workspaceId,
    // Stamped only when it is not the default. `scope` carries
    // `.default('active')`, so it is always present on the parsed query;
    // binding it unconditionally would put a constant in every fingerprint and
    // reject every cursor minted before the field existed — which is every
    // cursor the deployed build handed out, since `scope` is new here.
    scope: query.scope === 'active' ? undefined : query.scope,
    folderPath: query.folderPath,
    search: query.search,
  })
}

/**
 * GET /api/v2/knowledge — List knowledge bases in a workspace.
 *
 * `scope=archived` lists the soft-deleted set a `POST /api/v2/knowledge/{knowledgeBaseId}/restore`
 * can bring back. It is the same operation as the active list — the same rows under
 * a different `deleted_at` predicate — so it is a filter here rather than a sibling
 * path, matching files, tables, and workflows.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListKnowledgeBasesContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.list,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    scope: query.scope,
    folderPath: query.folderPath,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      knowledgeCursorFilters(query)
    ),
  }),
  useCase: listKnowledgeBases,
  present: async ({ knowledgeBases, nextCursorKeys }, { query }) => ({
    data: await toV2KnowledgeBases(knowledgeBases),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      knowledgeCursorFilters(query)
    ),
  }),
})

/** POST /api/v2/knowledge — Create a new knowledge base. */
export const POST = defineV2JsonRoute({
  contract: v2CreateKnowledgeBaseContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.create,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
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
    if (isUserCredentialPrincipal(principal)) {
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
