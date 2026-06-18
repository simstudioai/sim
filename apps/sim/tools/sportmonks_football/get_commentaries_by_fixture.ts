import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_COMMENTARY_PROPERTIES,
  SPORTMONKS_FOOTBALL_BASE_URL,
  type SportmonksCommentary,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetCommentariesByFixtureParams extends SportmonksBaseParams {
  fixtureId: string
}

export interface SportmonksGetCommentariesByFixtureResponse extends ToolResponse {
  output: {
    commentaries: SportmonksCommentary[]
  }
}

export const sportmonksGetCommentariesByFixtureTool: ToolConfig<
  SportmonksGetCommentariesByFixtureParams,
  SportmonksGetCommentariesByFixtureResponse
> = {
  id: 'sportmonks_football_get_commentaries_by_fixture',
  name: 'Get Commentaries by Fixture',
  description: 'Retrieve textual commentary for a fixture by fixture ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    fixtureId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the fixture',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Semicolon-separated relations to enrich the response (e.g. player;relatedPlayer)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/commentaries/fixtures/${encodeURIComponent(params.fixtureId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_commentaries_by_fixture')
    }
    return {
      success: true,
      output: {
        commentaries: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    commentaries: {
      type: 'array',
      description: 'Array of commentary entries for the fixture',
      items: { type: 'object', properties: SPORTMONKS_COMMENTARY_PROPERTIES },
    },
  },
}
