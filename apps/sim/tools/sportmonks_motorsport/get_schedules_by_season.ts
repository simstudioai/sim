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
  SPORTMONKS_MOTORSPORT_BASE_URL,
  SPORTMONKS_MS_STAGE_PROPERTIES,
  type SportmonksMsStage,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetSchedulesBySeasonParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  seasonId: string
}

export interface SportmonksMsGetSchedulesBySeasonResponse extends ToolResponse {
  output: {
    schedules: SportmonksMsStage[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksMotorsportGetSchedulesBySeasonTool: ToolConfig<
  SportmonksMsGetSchedulesBySeasonParams,
  SportmonksMsGetSchedulesBySeasonResponse
> = {
  id: 'sportmonks_motorsport_get_schedules_by_season',
  name: 'Get Schedules by Season',
  description:
    'Retrieve the full schedule (stages with nested fixtures and venues) for a season by season ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    seasonId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the season',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response',
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
      description: 'Order direction (asc or desc)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_MOTORSPORT_BASE_URL}/schedules/seasons/${encodeURIComponent(params.seasonId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_schedules_by_season')
    }
    return {
      success: true,
      output: {
        schedules: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    schedules: {
      type: 'array',
      description:
        'Array of stage objects for the season schedule, each including nested fixtures and venues',
      items: { type: 'object', properties: SPORTMONKS_MS_STAGE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
