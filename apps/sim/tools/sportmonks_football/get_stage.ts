import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_STAGE_PROPERTIES,
  type SportmonksStage,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetStageParams extends SportmonksBaseParams {
  stageId: string
}

export interface SportmonksGetStageResponse extends ToolResponse {
  output: {
    stage: SportmonksStage | null
  }
}

export const sportmonksGetStageTool: ToolConfig<
  SportmonksGetStageParams,
  SportmonksGetStageResponse
> = {
  id: 'sportmonks_football_get_stage',
  name: 'Get Stage by ID',
  description: 'Retrieve a single football stage by its ID from Sportmonks',
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
        'Semicolon-separated relations to enrich the response (e.g. league;season;rounds)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/stages/${encodeURIComponent(params.stageId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_stage')
    }
    return {
      success: true,
      output: {
        stage: data.data ?? null,
      },
    }
  },

  outputs: {
    stage: {
      type: 'object',
      description: 'The requested stage object',
      properties: SPORTMONKS_STAGE_PROPERTIES,
    },
  },
}
