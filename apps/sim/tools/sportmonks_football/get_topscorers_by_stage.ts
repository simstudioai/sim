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
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_TOPSCORER_PROPERTIES,
  type SportmonksTopscorer,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTopscorersByStageParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  stageId: string
}

export interface SportmonksGetTopscorersByStageResponse extends ToolResponse {
  output: {
    topscorers: SportmonksTopscorer[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetTopscorersByStageTool: ToolConfig<
  SportmonksGetTopscorersByStageParams,
  SportmonksGetTopscorersByStageResponse
> = {
  id: 'sportmonks_football_get_topscorers_by_stage',
  name: 'Get Topscorers by Stage',
  description: 'Retrieve topscorers for a stage by stage ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    stageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the stage',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Semicolon-separated relations to enrich the response (e.g. player;participant;type)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. stageTopscorerTypes:208)',
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
      description: 'Order direction (asc or desc)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/topscorers/stages/${encodeURIComponent(params.stageId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_topscorers_by_stage')
    }
    return {
      success: true,
      output: {
        topscorers: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    topscorers: {
      type: 'array',
      description: 'Array of topscorer entries for the stage',
      items: { type: 'object', properties: SPORTMONKS_TOPSCORER_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
