import type {
  InstagramGetMessageParams,
  InstagramGetMessageResponse,
} from '@/tools/instagram/types'
import { bearerHeaders, graphUrl, readGraphError } from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramGetMessageTool: ToolConfig<
  InstagramGetMessageParams,
  InstagramGetMessageResponse
> = {
  id: 'instagram_get_message',
  name: 'Instagram Get Message',
  description: 'Get a single Instagram Direct message by id (only recent messages are available)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'instagram',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Instagram API',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message id',
    },
  },

  request: {
    url: (params) =>
      graphUrl(`/${params.messageId.trim()}`, {
        fields: 'id,created_time,from,to,message',
      }),
    method: 'GET',
    headers: (params) => bearerHeaders(params.accessToken),
  },

  transformResponse: async (response): Promise<InstagramGetMessageResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: {
          id: null,
          createdTime: null,
          fromId: null,
          fromUsername: null,
          toId: null,
          message: null,
        },
        error: await readGraphError(response),
      }
    }

    const data = await response.json()
    const from = data.from as { id?: string; username?: string } | undefined
    const toData = data.to?.data
    const toFirst = Array.isArray(toData) ? toData[0] : undefined

    return {
      success: true,
      output: {
        id: data.id ?? null,
        createdTime: data.created_time ?? null,
        fromId: from?.id ?? null,
        fromUsername: from?.username ?? null,
        toId: toFirst?.id ?? null,
        message: data.message ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Message id', optional: true },
    createdTime: { type: 'string', description: 'Created timestamp', optional: true },
    fromId: { type: 'string', description: 'Sender Instagram-scoped id', optional: true },
    fromUsername: { type: 'string', description: 'Sender username', optional: true },
    toId: { type: 'string', description: 'Recipient id', optional: true },
    message: { type: 'string', description: 'Message text', optional: true },
  },
}
