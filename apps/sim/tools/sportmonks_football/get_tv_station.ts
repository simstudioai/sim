import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_TVSTATION_PROPERTIES,
  type SportmonksTVStation,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTvStationParams extends SportmonksBaseParams {
  tvStationId: string
}

export interface SportmonksGetTvStationResponse extends ToolResponse {
  output: {
    tvStation: SportmonksTVStation | null
  }
}

export const sportmonksGetTvStationTool: ToolConfig<
  SportmonksGetTvStationParams,
  SportmonksGetTvStationResponse
> = {
  id: 'sportmonks_football_get_tv_station',
  name: 'Get TV Station by ID',
  description: 'Retrieve a single TV station by its ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    tvStationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the TV station',
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
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/tv-stations/${encodeURIComponent(params.tvStationId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_tv_station')
    }
    return {
      success: true,
      output: {
        tvStation: data.data ?? null,
      },
    }
  },

  outputs: {
    tvStation: {
      type: 'object',
      description: 'The requested TV station object',
      properties: SPORTMONKS_TVSTATION_PROPERTIES,
    },
  },
}
