import { v2ListChatRunsContract } from '@/lib/api/contracts/v2/chat-runs'
import { INVALID_CURSOR_MESSAGE } from '@/lib/api/list-query'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { toPublicChatRunSummary } from '@/lib/copilot/chat/api/run-presenters'
import { v2ChatRunErrorPolicies } from '@/lib/copilot/chat/api/run-route-policy'
import { chatOperations } from '@/lib/copilot/chat/application/operations'
import { listChatRuns } from '@/lib/copilot/chat/application/runs'
import { encodePublicChatRunCursor, PUBLIC_CHAT_RUN_SORT } from '@/lib/copilot/chat/public-runs'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decodeSortedCursor, encodeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function decodeCursor(cursor: string | undefined) {
  const decoded = decodeSortedCursor(cursor, PUBLIC_CHAT_RUN_SORT)
  if (decoded.status === 'invalid') {
    throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
  }
  return decoded.status === 'ok' ? decoded.keys : undefined
}

/** GET /api/v2/chat/runs — list owned root Mothership chat runs. */
export const GET = defineV2JsonRoute({
  contract: v2ListChatRunsContract,
  auth: v2ApiKeyAuth,
  operation: chatOperations.listRuns,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2ChatRunErrorPolicies.default,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    status: query.status,
    limit: query.limit,
    cursorKeys: decodeCursor(query.cursor),
  }),
  useCase: listChatRuns,
  present: ({ rows, hasMore }) => {
    const last = rows.at(-1)
    return {
      data: rows.map(toPublicChatRunSummary),
      nextCursor:
        hasMore && last
          ? encodeSortedCursor(PUBLIC_CHAT_RUN_SORT, encodePublicChatRunCursor(last))
          : null,
    }
  },
})
