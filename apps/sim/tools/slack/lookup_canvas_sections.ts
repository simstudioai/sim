import type {
  SlackLookupCanvasSectionsParams,
  SlackLookupCanvasSectionsResponse,
} from '@/tools/slack/types'
import { CANVAS_SECTION_OUTPUT_PROPERTIES } from '@/tools/slack/types'
import type { ToolConfig } from '@/tools/types'

const parseCriteria = (criteria: SlackLookupCanvasSectionsParams['criteria']) => {
  if (typeof criteria !== 'string') {
    return criteria
  }

  try {
    return JSON.parse(criteria)
  } catch {
    throw new Error('Canvas section criteria must be a valid JSON object')
  }
}

export const slackLookupCanvasSectionsTool: ToolConfig<
  SlackLookupCanvasSectionsParams,
  SlackLookupCanvasSectionsResponse
> = {
  id: 'slack_lookup_canvas_sections',
  name: 'Slack Lookup Canvas Sections',
  description: 'Find Slack canvas section IDs matching criteria for later edits',
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
      description: 'Canvas ID to search (e.g., F1234ABCD)',
    },
    criteria: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Section lookup criteria, such as {"section_types":["h1"],"contains_text":"Roadmap"}',
    },
  },

  request: {
    url: 'https://slack.com/api/canvases.sections.lookup',
    method: 'POST',
    headers: (params: SlackLookupCanvasSectionsParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken || params.botToken}`,
    }),
    body: (params: SlackLookupCanvasSectionsParams) => ({
      canvas_id: params.canvasId.trim(),
      criteria: parseCriteria(params.criteria),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.ok) {
      if (data.error === 'canvas_not_found') {
        throw new Error('Canvas not found or not visible to the authenticated Slack user or bot.')
      }
      if (data.error === 'missing_scope') {
        throw new Error(
          'Missing required permissions. Please reconnect your Slack account with the canvases:read scope.'
        )
      }
      throw new Error(data.error || 'Failed to look up canvas sections')
    }

    return {
      success: true,
      output: {
        sections: data.sections ?? [],
      },
    }
  },

  outputs: {
    sections: {
      type: 'array',
      description: 'Canvas sections matching the lookup criteria',
      items: {
        type: 'object',
        properties: CANVAS_SECTION_OUTPUT_PROPERTIES,
      },
    },
  },
}
