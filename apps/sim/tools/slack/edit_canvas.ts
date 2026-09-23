import { z } from 'zod'
import { readSlackResponse } from '@/tools/slack/api'
import type { SlackEditCanvasParams, SlackEditCanvasResponse } from '@/tools/slack/types'
import { requireSlackString } from '@/tools/slack/utils'
import type { ToolConfig } from '@/tools/types'

export const slackEditCanvasTool: ToolConfig<SlackEditCanvasParams, SlackEditCanvasResponse> = {
  id: 'slack_edit_canvas',
  name: 'Slack Edit Canvas',
  description: 'Edit an existing Slack canvas by inserting, replacing, or deleting content',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'slack',
    requiredScopes: ['canvases:write'],
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
        'Section ID to target (required for insert_after, insert_before, and delete; omit for replace to replace the whole canvas)',
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
      z.enum([
        'insert_at_start',
        'insert_at_end',
        'insert_after',
        'insert_before',
        'replace',
        'delete',
        'rename',
      ]).parse(params.operation)
      requireSlackString(params.canvasId, 'Canvas ID')
      if (['insert_after', 'insert_before', 'delete'].includes(params.operation)) {
        requireSlackString(params.sectionId, 'Section ID')
      }
      if (params.operation === 'rename') {
        requireSlackString(params.title, 'New canvas title')
      } else if (params.operation !== 'delete') {
        z.string().min(1, 'Markdown content is required').max(1048576).parse(params.content)
      }
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
    await readSlackResponse(response)

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
