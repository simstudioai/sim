import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import { DEFAULT_MAX_PAGES } from '@/tools/slack/get_channel_history'
import type { SlackGetChannelHistoryParams } from '@/tools/slack/types'
import { fetchSlackMessagesPaginated, resolvePositiveInt } from '@/tools/slack/utils'

export const executeSlackGetChannelHistoryOperation: InternalToolOperationImplementation<
  SlackGetChannelHistoryParams
> = async (params: SlackGetChannelHistoryParams, signal) => {
  const token = params.accessToken || params.botToken
  if (!token) {
    throw new Error('Missing Slack credentials. Provide an OAuth connection or a bot token.')
  }

  const result = await fetchSlackMessagesPaginated({
    token,
    method: 'conversations.history',
    baseParams: {
      channel: params.channel,
      oldest: params.oldest,
      latest: params.latest,
      inclusive: params.inclusive ? 'true' : undefined,
    },
    limit: resolvePositiveInt(params.limit, 200),
    cursor: params.cursor,
    maxPages: resolvePositiveInt(params.maxPages, DEFAULT_MAX_PAGES),
    missingScopeHint: 'channels:history, groups:history, im:history, mpim:history',
    signal,
  })

  return {
    success: true,
    output: {
      messages: result.messages,
      count: result.messages.length,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      pages: result.pages,
    },
  }
}
