import type { SlackEditCanvasParams, SlackEditCanvasResponse } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

export const slackEditCanvasTool: ToolConfig<SlackEditCanvasParams, SlackEditCanvasResponse> = {
  id: 'slack_edit_canvas',
  name: 'Slack Edit Canvas',
  description: 'Edit an existing Slack canvas by inserting, replacing, or deleting content',
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
      description: 'Canvas ID to edit (e.g., F1234ABCD)',
    },
    operation: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Edit operation: insert_at_start, insert_at_end, insert_after, insert_before, replace, delete, or rename',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Markdown content for the operation (required for insert/replace operations)',
    },
    sectionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Section ID to target (required for insert_after, insert_before, replace, and delete)',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New title for the canvas (only used with rename operation)',
    },
  },

  request: {
    url: 'https://slack.com/api/canvases.edit',
    method: 'POST',
    headers: (params: SlackEditCanvasParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackEditCanvasParams) => {
      const change: Record<string, unknown> = {
        operation: params.operation,
      }

      if (params.sectionId) {
        change.section_id = params.sectionId.trim()
      }

      if (params.operation === 'rename' && params.title) {
        change.title_content = {
          type: 'markdown',
          markdown: params.title,
        }
      } else if (params.content && params.operation !== 'delete') {
        change.document_content = {
          type: 'markdown',
          markdown: params.content,
        }
      }

      return {
        canvas_id: params.canvasId.trim(),
        changes: [change],
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      throw new Error(data.error || 'Failed to edit canvas')
    }

    return {
      success: true,
      output: {
        content: 'Successfully edited canvas',
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Success message' },
  },
}
