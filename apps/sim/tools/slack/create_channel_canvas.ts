import type {
  SlackCreateChannelCanvasParams,
  SlackCreateChannelCanvasResponse,
} from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackCreateChannelCanvasTool: ToolConfig<
  SlackCreateChannelCanvasParams,
  SlackCreateChannelCanvasResponse
> = {
  id: 'slack_create_channel_canvas',
  name: 'Slack Create Channel Canvas',
  description: 'Create a canvas pinned to a Slack channel as its resource hub',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'slack',
  },

  params: {
    authMethod: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Authentication method: oauth or bot_token',
    },
    botToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Bot token for Custom Bot',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth access token or bot token for Slack API',
    },
    channel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Channel ID to create the canvas in (e.g., C1234567890)',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Title for the channel canvas',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Canvas content in markdown format',
    },
  },

  request: {
    url: 'https://slack.com/api/conversations.canvases.create',
    method: 'POST',
    headers: (params: SlackCreateChannelCanvasParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackCreateChannelCanvasParams) => {
      const body: Record<string, unknown> = {
        channel_id: params.channel.trim(),
      }

      if (params.title) {
        body.title = params.title
      }

      if (params.content) {
        body.document_content = {
          type: 'markdown',
          markdown: params.content,
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'channel_canvas_already_exists') {
        throw new Error('A canvas already exists for this channel. Use Edit Canvas to modify it.')
      }
      throw new Error(data.error || 'Failed to create channel canvas')
    }

    return {
      success: true,
      output: {
        canvas_id: data.canvas_id,
      },
    }
  },

  outputs: {
    canvas_id: { type: 'string', description: 'ID of the created channel canvas' },
  },
}
