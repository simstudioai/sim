import { validateEnum } from '@/lib/core/security/input-validation'
import type { RedditGetMessagesParams, RedditMessagesResponse } from '@/tools/reddit/types'
import type { ToolConfig } from '@/tools/types'

const ALLOWED_MESSAGE_FOLDERS = [
  'inbox',
  'unread',
  'sent',
  'messages',
  'comments',
  'selfreply',
  'mentions',
] as const

export const getMessagesTool: ToolConfig<RedditGetMessagesParams, RedditMessagesResponse> = {
  id: 'reddit_get_messages',
  name: 'Get Reddit Messages',
  description: 'Retrieve private messages from your Reddit inbox',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'reddit',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Reddit API',
    },
    where: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Message folder to retrieve: "inbox" (all), "unread", "sent", "messages" (direct messages only), "comments" (comment replies), "selfreply" (self-post replies), or "mentions" (username mentions). Default: "inbox"',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of messages to return (e.g., 25). Default: 25, max: 100',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fullname of a thing to fetch items after (for pagination)',
    },
    before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fullname of a thing to fetch items before (for pagination)',
    },
    mark: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to mark fetched messages as read',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'A count of items already seen in the listing (used for numbering)',
    },
    show: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Show items that would normally be filtered (e.g., "all")',
    },
  },

  request: {
    url: (params: RedditGetMessagesParams) => {
      const where = params.where || 'inbox'
      const validation = validateEnum(where, ALLOWED_MESSAGE_FOLDERS, 'where')
      if (!validation.isValid) {
        throw new Error(validation.error)
      }
      const limit = Math.min(Math.max(1, params.limit ?? 25), 100)

      const urlParams = new URLSearchParams({
        limit: limit.toString(),
        raw_json: '1',
      })

      if (params.after) urlParams.append('after', params.after)
      if (params.before) urlParams.append('before', params.before)
      if (params.mark !== undefined) urlParams.append('mark', params.mark.toString())
      if (params.count !== undefined) urlParams.append('count', Number(params.count).toString())
      if (params.show) urlParams.append('show', params.show)

      return `https://oauth.reddit.com/message/${where}?${urlParams.toString()}`
    },
    method: 'GET',
    headers: (params: RedditGetMessagesParams) => {
      if (!params.accessToken) {
        throw new Error('Access token is required for Reddit API')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'User-Agent': 'sim-studio/1.0 (https://github.com/simstudioai/sim)',
        Accept: 'application/json',
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: { messages: [], after: null, before: null },
      }
    }

    const messages =
      data.data?.children?.map((child: any) => {
        const msg = child.data || {}
        return {
          id: msg.id ?? '',
          name: msg.name ?? '',
          author: msg.author ?? '',
          dest: msg.dest ?? '',
          subject: msg.subject ?? '',
          body: msg.body ?? '',
          created_utc: msg.created_utc ?? 0,
          new: msg.new ?? false,
          was_comment: msg.was_comment ?? false,
          context: msg.context ?? '',
          distinguished: msg.distinguished ?? null,
        }
      }) || []

    return {
      success: true,
      output: {
        messages,
        after: data.data?.after ?? null,
        before: data.data?.before ?? null,
      },
    }
  },

  outputs: {
    messages: {
      type: 'array',
      description: 'Array of messages with sender, recipient, subject, body, and metadata',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Message ID' },
          name: { type: 'string', description: 'Thing fullname (t4_xxxxx)' },
          author: { type: 'string', description: 'Sender username' },
          dest: { type: 'string', description: 'Recipient username' },
          subject: { type: 'string', description: 'Message subject' },
          body: { type: 'string', description: 'Message body text' },
          created_utc: { type: 'number', description: 'Creation time in UTC epoch seconds' },
          new: { type: 'boolean', description: 'Whether the message is unread' },
          was_comment: { type: 'boolean', description: 'Whether the message is a comment reply' },
          context: { type: 'string', description: 'Context URL for comment replies' },
          distinguished: {
            type: 'string',
            description: 'Distinction: null/"moderator"/"admin"',
            optional: true,
          },
        },
      },
    },
    after: {
      type: 'string',
      description: 'Fullname of the last item for forward pagination',
      optional: true,
    },
    before: {
      type: 'string',
      description: 'Fullname of the first item for backward pagination',
      optional: true,
    },
  },
}
