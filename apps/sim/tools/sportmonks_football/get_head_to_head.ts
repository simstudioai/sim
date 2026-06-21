import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  SPORTMONKS_PAGINATION_OUTPUT,
  type SportmonksBaseParams,
  type SportmonksPagination,
  type SportmonksPaginationParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FIXTURE_PROPERTIES,
  SPORTMONKS_FOOTBALL_BASE_URL,
  type SportmonksFixture,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetHeadToHeadParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  team1: string
  team2: string
}

export interface SportmonksGetHeadToHeadResponse extends ToolResponse {
  output: {
    fixtures: SportmonksFixture[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetHeadToHeadTool: ToolConfig<
  SportmonksGetHeadToHeadParams,
  SportmonksGetHeadToHeadResponse
> = {
  id: 'sportmonks_football_get_head_to_head',
  name: 'Get Head to Head',
  description: 'Retrieve the head-to-head fixtures between two teams from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    team1: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The id of the first team',
    },
    team2: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The id of the second team',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Semicolon-separated relations to enrich the response (e.g. participants;scores)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply',
    },
    per_page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (max 50, default 25)',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number to retrieve',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order fixtures by starting_at (asc or desc)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/fixtures/head-to-head/${encodeURIComponent(
        params.team1.trim()
      )}/${encodeURIComponent(params.team2.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_head_to_head')
    }
    return {
      success: true,
      output: {
        fixtures: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    fixtures: {
      type: 'array',
      description: 'Array of head-to-head fixture objects between the two teams',
      items: { type: 'object', properties: SPORTMONKS_FIXTURE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
