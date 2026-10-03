import { v2RestoreKnowledgeBaseContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { restoreKnowledgeBase } from '@/lib/knowledge/application/knowledge-bases'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { toV2KnowledgeBase } from '@/app/api/v2/knowledge/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/knowledge/[knowledgeBaseId]/restore — Recover a soft-deleted knowledge base.
 *
 * Idempotent: restoring one that is already active answers 200 with its current
 * representation and records no audit entry, so a retry after a dropped
 * response cannot read as a failure. Find restorable bases with
 * `GET /api/v2/knowledge?scope=archived`.
 */
export const POST = defineV2JsonRoute({
  contract: v2RestoreKnowledgeBaseContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.restore,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: body.workspaceId,
    source: 'api' as const,
  }),
  useCase: restoreKnowledgeBase,
  present: async ({ knowledgeBase, folderPath }) => ({
    data: await toV2KnowledgeBase(knowledgeBase, folderPath),
  }),
})
