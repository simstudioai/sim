import type { SlackListCanvasesParams, SlackListCanvasesResponse } from '@/tools/slack/types'
import { CANVAS_FILE_OUTPUT_PROPERTIES, CANVAS_PAGING_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import { mapCanvasFile } from '@/tools/slack/utils'
import type { ToolConfig } from '@/tools/types'

export const slackListCanvasesTool: ToolConfig<SlackListCanvasesParams, SlackListCanvasesResponse> =
  {
    id: 'slack_list_canvases',
    name: 'Slack List Canvases',
    description: 'List Slack canvases available to the authenticated user or bot',
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
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter canvases appearing in a specific channel ID',
      },
      count: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Number of canvases to return per page',
      },
      page: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Page number to return',
      },
      user: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter canvases created by a single user ID',
      },
      tsFrom: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter canvases created after this Unix timestamp',
      },
      tsTo: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Filter canvases created before this Unix timestamp',
      },
      teamId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Encoded team ID, required when using an org-level token',
      },
    },

    request: {
      url: (params: SlackListCanvasesParams) => {
        const url = new URL('https://slack.com/api/files.list')
        url.searchParams.append('types', 'canvas')

        if (params.channel) url.searchParams.append('channel', params.channel.trim())
        if (params.count) url.searchParams.append('count', String(params.count))
        if (params.page) url.searchParams.append('page', String(params.page))
        if (params.user) url.searchParams.append('user', params.user.trim())
        if (params.tsFrom) url.searchParams.append('ts_from', params.tsFrom.trim())
        if (params.tsTo) url.searchParams.append('ts_to', params.tsTo.trim())
        if (params.teamId) url.searchParams.append('team_id', params.teamId.trim())

        return url.toString()
      },
      method: 'GET',
      headers: (params: SlackListCanvasesParams) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken || params.botToken}`,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.ok) {
        if (data.error === 'unknown_type') {
          throw new Error('Slack did not recognize the canvas file type filter.')
        }
        throw new Error(data.error || 'Failed to list canvases from Slack')
      }

      return {
        success: true,
        output: {
          canvases: (data.files ?? []).map(mapCanvasFile),
          paging: {
            count: data.paging?.count ?? 0,
            total: data.paging?.total ?? 0,
            page: data.paging?.page ?? 0,
            pages: data.paging?.pages ?? 0,
          },
        },
      }
    },

    outputs: {
      canvases: {
        type: 'array',
        description: 'Canvas file objects returned by Slack',
        items: {
          type: 'object',
          properties: CANVAS_FILE_OUTPUT_PROPERTIES,
        },
      },
      paging: {
        type: 'object',
        description: 'Pagination information from Slack',
        properties: CANVAS_PAGING_OUTPUT_PROPERTIES,
      },
    },
  }
