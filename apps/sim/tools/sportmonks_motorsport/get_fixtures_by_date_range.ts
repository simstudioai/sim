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
  SPORTMONKS_MS_FIXTURE_PROPERTIES,
  type SportmonksMsFixture,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetFixturesByDateRangeParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  startDate: string
  endDate: string
}

export interface SportmonksMsGetFixturesByDateRangeResponse extends ToolResponse {
  output: {
    fixtures: SportmonksMsFixture[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksMotorsportGetFixturesByDateRangeTool: ToolConfig<
  SportmonksMsGetFixturesByDateRangeParams,
  SportmonksMsGetFixturesByDateRangeResponse
> = {
  id: 'sportmonks_motorsport_get_fixtures_by_date_range',
  name: 'Get Motorsport Fixtures by Date Range',
  description:
    'Retrieve motorsport fixtures (sessions) between two dates (YYYY-MM-DD, max 100 days) from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The start date of the range, in YYYY-MM-DD format',
    },
    endDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The end date of the range, in YYYY-MM-DD format',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. participants;venue)',
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
      const url = `${SPORTMONKS_MOTORSPORT_BASE_URL}/fixtures/between/${encodeURIComponent(params.startDate.trim())}/${encodeURIComponent(params.endDate.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_fixtures_by_date_range')
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
      description: 'Array of motorsport fixture (session) objects within the requested date range',
      items: { type: 'object', properties: SPORTMONKS_MS_FIXTURE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
