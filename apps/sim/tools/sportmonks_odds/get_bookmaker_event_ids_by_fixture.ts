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
  SPORTMONKS_BOOKMAKER_EVENT_PROPERTIES,
  SPORTMONKS_ODDS_BASE_URL,
  type SportmonksBookmakerEvent,
} from '@/tools/sportmonks_odds/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetBookmakerEventIdsByFixtureParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  fixtureId: string
}

export interface SportmonksGetBookmakerEventIdsByFixtureResponse extends ToolResponse {
  output: {
    bookmakerEvents: SportmonksBookmakerEvent[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksOddsGetBookmakerEventIdsByFixtureTool: ToolConfig<
  SportmonksGetBookmakerEventIdsByFixtureParams,
  SportmonksGetBookmakerEventIdsByFixtureResponse
> = {
  id: 'sportmonks_odds_get_bookmaker_event_ids_by_fixture',
  name: 'Get Bookmaker Event IDs by Fixture',
  description:
    "Retrieve bookmakers' own event ids mapped to a Sportmonks fixture via the Sportmonks Odds API",
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
      const url = `${SPORTMONKS_ODDS_BASE_URL}/bookmakers/fixtures/${encodeURIComponent(params.fixtureId.trim())}/mapping`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_bookmaker_event_ids_by_fixture')
    }
    return {
      success: true,
      output: {
        bookmakerEvents: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    bookmakerEvents: {
      type: 'array',
      description: 'Array of bookmaker event mapping records for the fixture',
      items: { type: 'object', properties: SPORTMONKS_BOOKMAKER_EVENT_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
