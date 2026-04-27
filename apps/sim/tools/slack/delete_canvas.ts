import type { SlackDeleteCanvasParams, SlackDeleteCanvasResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackDeleteCanvasTool: ToolConfig<SlackDeleteCanvasParams, SlackDeleteCanvasResponse> =
  {
    id: 'slack_delete_canvas',
    name: 'Slack Delete Canvas',
    description: 'Delete a Slack canvas by its canvas ID',
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
        description: 'Canvas ID to delete (e.g., F1234ABCD)',
      },
    },

    request: {
      url: 'https://slack.com/api/canvases.delete',
      method: 'POST',
      headers: (params: SlackDeleteCanvasParams) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken || params.botToken}`,
      }),
      body: (params: SlackDeleteCanvasParams) => ({
        canvas_id: params.canvasId.trim(),
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.ok) {
        if (data.error === 'canvas_not_found') {
          throw new Error('Canvas not found or not visible to the authenticated Slack user or bot.')
        }
        if (data.error === 'canvas_deleting_disabled') {
          throw new Error('Canvas deletion is disabled for this workspace.')
        }
        throw new Error(data.error || 'Failed to delete canvas')
      }

      return {
        success: true,
        output: {
          ok: data.ok,
        },
      }
    },

    outputs: {
      ok: { type: 'boolean', description: 'Whether Slack deleted the canvas successfully' },
    },
  }
