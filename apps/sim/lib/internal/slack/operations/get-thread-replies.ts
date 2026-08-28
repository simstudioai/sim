import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { DEFAULT_MAX_PAGES } from '@/tools/slack/get_thread_replies'
import type { SlackGetThreadRepliesParams } from '@/tools/slack/types'
import { fetchSlackMessagesPaginated, resolvePositiveInt } from '@/tools/slack/utils'

export const executeSlackGetThreadRepliesOperation: InternalToolOperationImplementation<
  SlackGetThreadRepliesParams
> = async (params: SlackGetThreadRepliesParams) => {
  const token = params.accessToken || params.botToken
  if (!token) {
    throw new Error('Missing Slack credentials. Provide an OAuth connection or a bot token.')
  }

  const result = await fetchSlackMessagesPaginated({
    token,
    method: 'conversations.replies',
    baseParams: {
      channel: params.channel,
      ts: params.threadTs,
      oldest: params.oldest,
      latest: params.latest,
      inclusive: params.inclusive ? 'true' : undefined,
    },
    limit: resolvePositiveInt(params.limit, 200),
    cursor: params.cursor,
    maxPages: resolvePositiveInt(params.maxPages, DEFAULT_MAX_PAGES),
    missingScopeHint: 'channels:history, groups:history, im:history, mpim:history',
  })

  const messages = result.messages
  const threadTs = params.threadTs?.trim()
  const parentMessage = messages.find((msg) => msg.ts === threadTs) ?? null
  const replies = parentMessage ? messages.filter((msg) => msg !== parentMessage) : messages

  return {
    success: true,
    output: {
      parentMessage,
      replies,
      messages,
      replyCount: replies.length,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      pages: result.pages,
    },
  }
}
