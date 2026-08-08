import { v2GetChatRunContract } from '@/lib/api/contracts/v2/chat-runs'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { toPublicChatRunSummary } from '@/lib/copilot/chat/api/run-presenters'
import { v2ChatRunErrorPolicies } from '@/lib/copilot/chat/api/run-route-policy'
import { chatOperations } from '@/lib/copilot/chat/application/operations'
import { readChatRun } from '@/lib/copilot/chat/application/runs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/chat/runs/[runId] — safe pollable run status and progress. */
export const GET = defineV2JsonRoute({
  contract: v2GetChatRunContract,
  auth: v2ApiKeyAuth,
  operation: chatOperations.readRun,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2ChatRunErrorPolicies.detail,
  mapInput: ({ params, query }) => ({
    runId: params.runId,
    workspaceId: query.workspaceId,
  }),
  useCase: readChatRun,
  present: ({ run, status, completedAt, response, activities }) => ({
    data: {
      ...toPublicChatRunSummary(run),
      status,
      completedAt: completedAt?.toISOString() ?? null,
      response,
      activities,
    },
  }),
})
