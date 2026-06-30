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
  SPORTMONKS_STATISTIC_PROPERTIES,
  type SportmonksStatistic,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetStageStatisticsParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  stageId: string
}

export interface SportmonksGetStageStatisticsResponse extends ToolResponse {
  output: {
    statistics: SportmonksStatistic[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetStageStatisticsTool: ToolConfig<
  SportmonksGetStageStatisticsParams,
  SportmonksGetStageStatisticsResponse
> = {
  id: 'sportmonks_football_get_stage_statistics',
  name: 'Get Stage Statistics',
  description: 'Retrieve all available statistics for a stage ID from Sportmonks',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. participant)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. seasonstatisticTypes:52,88)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/statistics/stages/${encodeURIComponent(params.stageId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_stage_statistics')
    }
    return {
      success: true,
      output: {
        statistics: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    statistics: {
      type: 'array',
      description: 'Array of statistic entries for the stage',
      items: { type: 'object', properties: SPORTMONKS_STATISTIC_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
