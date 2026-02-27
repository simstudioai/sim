import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { XHideReplyParams, XHideReplyResponse } from '@/tools/x/types'

const logger = createLogger('XHideReplyTool')

export const xHideReplyTool: ToolConfig<XHideReplyParams, XHideReplyResponse> = {
  id: 'x_hide_reply',
  name: 'X Hide Reply',
  description: 'Hide or unhide a reply to a tweet authored by the authenticated user',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'x',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'X OAuth access token',
    },
    tweetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The reply tweet ID to hide or unhide',
    },
    hidden: {
      type: 'boolean',
      required: true,
      visibility: 'user-or-llm',
      description: 'Set to true to hide the reply, false to unhide',
    },
  },

  request: {
    url: (params) => `https://api.x.com/2/tweets/${params.tweetId.trim()}/hidden`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      hidden: params.hidden,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!data.data) {
      logger.error('X Hide Reply API Error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.errors?.[0]?.detail || 'Failed to hide/unhide reply',
        output: {
          hidden: false,
        },
      }
    }

    return {
      success: true,
      output: {
        hidden: data.data?.hidden ?? false,
      },
    }
  },

  outputs: {
    hidden: {
      type: 'boolean',
      description: 'Whether the reply is now hidden',
    },
  },
}
