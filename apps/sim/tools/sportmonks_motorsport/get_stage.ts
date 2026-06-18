import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_MOTORSPORT_BASE_URL,
  SPORTMONKS_MS_STAGE_PROPERTIES,
  type SportmonksMsStage,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetStageParams extends SportmonksBaseParams {
  stageId: string
}

export interface SportmonksMsGetStageResponse extends ToolResponse {
  output: {
    stage: SportmonksMsStage | null
  }
}

export const sportmonksMotorsportGetStageTool: ToolConfig<
  SportmonksMsGetStageParams,
  SportmonksMsGetStageResponse
> = {
  id: 'sportmonks_motorsport_get_stage',
  name: 'Get Stage by ID',
  description: 'Retrieve a single motorsport stage (race weekend) by its ID from Sportmonks',
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
      description: 'The unique id of the stage (race weekend)',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Semicolon-separated relations to enrich the response (e.g. league;season;fixtures)',
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
      const url = `${SPORTMONKS_MOTORSPORT_BASE_URL}/stages/${encodeURIComponent(params.stageId.trim())}`
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
      description: 'The requested stage (race weekend) object',
      properties: SPORTMONKS_MS_STAGE_PROPERTIES,
    },
  },
}
