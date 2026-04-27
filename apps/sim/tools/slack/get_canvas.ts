import type { SlackGetCanvasParams, SlackGetCanvasResponse } from '@/tools/slack/types'
import { CANVAS_FILE_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import { mapCanvasFile } from '@/tools/slack/utils'
import type { ToolConfig } from '@/tools/types'

export const slackGetCanvasTool: ToolConfig<SlackGetCanvasParams, SlackGetCanvasResponse> = {
  id: 'slack_get_canvas',
  name: 'Slack Get Canvas Info',
  description: 'Get Slack canvas file metadata by canvas ID',
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
    canvasId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Canvas file ID to retrieve (e.g., F1234ABCD)',
    },
  },

  request: {
    url: (params: SlackGetCanvasParams) => {
      const url = new URL('https://slack.com/api/files.info')
      url.searchParams.append('file', params.canvasId.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params: SlackGetCanvasParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'file_not_found') {
        throw new Error('Canvas not found. Please check the canvas ID and try again.')
      }
      if (data.error === 'not_visible') {
        throw new Error('Canvas is not visible to the authenticated Slack user or bot.')
      }
      throw new Error(data.error || 'Failed to get canvas from Slack')
    }

    return {
      success: true,
      output: {
        canvas: mapCanvasFile(data.file),
      },
    }
  },

  outputs: {
    canvas: {
      type: 'object',
      description: 'Canvas file information returned by Slack',
      properties: CANVAS_FILE_OUTPUT_PROPERTIES,
    },
  },
}
