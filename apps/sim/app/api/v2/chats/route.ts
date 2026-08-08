import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { type V2ChatSummary, v2ListChatsContract } from '@/lib/api/contracts/v2/chats'
import {
  encodeKeyset,
  keysetAfter,
  keysetColumns,
  listOrderBy,
  numberKey,
  searchFilter,
  timestampKey,
  uuidKey,
} from '@/lib/api/list-query'
import { parseRequest } from '@/lib/api/server'
import { reconcileChatStreamMarkers } from '@/lib/copilot/chat/stream-liveness'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  decodeSortedCursor,
  encodeSortedCursor,
  v2CursorList,
  v2CursorSortError,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2ChatsAPI')
const CHAT_SORT = 'pinned:desc,updatedAt:desc'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type ChatRow = {
  id: string
  title: string | null
  updatedAt: Date
  pinned: boolean
  activeStreamId: string | null
}

const pinnedRank = sql<number>`case when ${copilotChats.pinned} then 1 else 0 end`
const CHAT_KEYS = [
  numberKey<ChatRow>(pinnedRank, (row) => (row.pinned ? 1 : 0)),
  timestampKey<ChatRow>(copilotChats.updatedAt, (row) => row.updatedAt),
  uuidKey<ChatRow>(copilotChats.id, (row) => row.id),
]

/** GET /api/v2/chats — bounded personal chat history for the terminal picker. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'copilot-chat')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    // A workspace key can be held by people other than its creator. Its
    // creator's UI chats are private and must never become shared-key data.
    if (rateLimit.keyType === 'workspace') {
      return v2Error('FORBIDDEN', 'Chat history requires a personal API key')
    }

    const parsed = await parseRequest(
      v2ListChatsContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response
    const { workspaceId, search, limit, cursor } = parsed.data.query

    const accessPrincipal = isAuthDisabled ? { ...rateLimit, keyType: undefined } : rateLimit
    const access = await resolveWorkspaceAccess(accessPrincipal, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const decoded = decodeSortedCursor(cursor, CHAT_SORT)
    if (decoded.status === 'invalid') return v2CursorSortError()
    const resumeAfter =
      decoded.status === 'ok' ? keysetAfter(CHAT_KEYS, decoded.keys, 'desc') : undefined
    if (resumeAfter === null) return v2CursorSortError()

    const rows = await db
      .select({
        id: copilotChats.id,
        title: copilotChats.title,
        updatedAt: copilotChats.updatedAt,
        pinned: copilotChats.pinned,
        activeStreamId: copilotChats.conversationId,
      })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.userId, userId),
          eq(copilotChats.workspaceId, workspaceId),
          eq(copilotChats.type, 'mothership'),
          isNull(copilotChats.deletedAt),
          searchFilter(copilotChats.title, search),
          resumeAfter
        )
      )
      .orderBy(...listOrderBy(keysetColumns(CHAT_KEYS), 'desc'))
      .limit(limit + 1)

    const page = rows.slice(0, limit)
    const streamMarkers = await reconcileChatStreamMarkers(
      page.map((chat) => ({ chatId: chat.id, streamId: chat.activeStreamId })),
      { repairVerifiedStaleMarkers: true }
    )
    const data: V2ChatSummary[] = page.map((chat) => ({
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt.toISOString(),
      pinned: chat.pinned,
      active: Boolean(streamMarkers.get(chat.id)?.streamId),
    }))

    const last = page.at(-1)
    const nextCursor =
      rows.length > limit && last
        ? encodeSortedCursor(CHAT_SORT, encodeKeyset(CHAT_KEYS, last))
        : null

    return v2CursorList(data, nextCursor, { rateLimit })
  } catch (error) {
    logger.error('Failed to list v2 chats', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
